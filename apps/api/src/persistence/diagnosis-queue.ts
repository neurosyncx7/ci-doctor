import { randomUUID } from 'node:crypto';
import type { DiagnosisResult } from '../diagnosis/contract.js';
import type { ExtractedFailureCluster } from '../diagnosis/failure-clustering.js';
import type { Database } from './database.js';

export type ClusterJob = { outboxId: string; leaseToken: string; attempt: number; incidentId: string };

export type DiagnosisJob = {
  outboxId: string;
  leaseToken: string;
  attempt: number;
  incidentId: string;
  clusterId: string;
  testName: string;
  errorExcerpt: string;
  logArtifactSha256: string;
};

export class PostgresDiagnosisQueue {
  constructor(private readonly database: Database) {}

  async claimClusterJob(): Promise<ClusterJob | null> {
    const claimed = await this.claim('diagnosis.cluster.requested');
    if (!claimed) {
      return null;
    }
    return { outboxId: claimed.id, leaseToken: claimed.leaseToken, attempt: claimed.attempt, incidentId: claimed.payload.incidentId };
  }

  async failCluster(job: ClusterJob): Promise<void> {
    await this.database.transaction(async (client) => {
      if (job.attempt >= 3) {
        if (!(await completeLease(client, job.outboxId, job.leaseToken))) {
          return;
        }
        await client.query(
          `UPDATE incidents SET state = 'NEEDS_REVIEW', version = version + 1, updated_at = now()
           WHERE id = $1`,
          [job.incidentId]
        );
        await client.query(
          `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
           VALUES ($1, 'failure.clustering_escalated', $2::uuid, $3::jsonb)`,
          [job.incidentId, randomUUID(), JSON.stringify({ reasonCode: 'evidence_unavailable' })]
        );
        return;
      }
      await client.query(
        `UPDATE outbox
         SET leased_until = NULL, lease_token = NULL,
             available_at = now() + (least(300, power(2, attempts))::text || ' seconds')::interval
         WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
        [job.outboxId, job.leaseToken]
      );
    });
  }

  async saveClusters(job: ClusterJob, clusters: ExtractedFailureCluster[]): Promise<void> {
    await this.database.transaction(async (client) => {
      if (!(await completeLease(client, job.outboxId, job.leaseToken))) {
        throw new Error('Cluster job lease was lost before completion');
      }
      for (const cluster of clusters) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO failure_clusters (incident_id, fingerprint, test_name, log_artifact_sha256, error_excerpt)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (incident_id, fingerprint) DO NOTHING
           RETURNING id`,
          [job.incidentId, cluster.fingerprint, cluster.testName, cluster.logArtifactSha256, cluster.errorExcerpt]
        );
        if (inserted.rowCount !== 1) {
          continue;
        }
        const clusterId = inserted.rows[0]!.id;
        await client.query(
          `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
           VALUES ($1, 'failure.clustered', $2::uuid, $3::jsonb)`,
          [job.incidentId, randomUUID(), JSON.stringify({ clusterId, testName: cluster.testName, fingerprint: cluster.fingerprint })]
        );
        await client.query(
          `INSERT INTO outbox (topic, dedupe_key, payload)
           VALUES ('diagnosis.work.requested', $1, $2::jsonb)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [`cluster:${clusterId}:diagnose`, JSON.stringify({ incidentId: job.incidentId, clusterId })]
        );
      }
    });
  }

  async claimDiagnosisJob(): Promise<DiagnosisJob | null> {
    const claimed = await this.claim('diagnosis.work.requested');
    if (!claimed) {
      return null;
    }
    const context = await this.database.pool.query<{
      test_name: string;
      error_excerpt: string;
      log_artifact_sha256: string;
    }>(
      `SELECT test_name, error_excerpt, log_artifact_sha256
       FROM failure_clusters WHERE id = $1 AND incident_id = $2 AND state = 'PENDING'`,
      [claimed.payload.clusterId, claimed.payload.incidentId]
    );
    if (context.rowCount !== 1) {
      throw new Error('Diagnosis work item referenced an unavailable failure cluster');
    }
    const cluster = context.rows[0]!;
    return {
      outboxId: claimed.id,
      leaseToken: claimed.leaseToken,
      attempt: claimed.attempt,
      incidentId: claimed.payload.incidentId,
      clusterId: claimed.payload.clusterId,
      testName: cluster.test_name,
      errorExcerpt: cluster.error_excerpt,
      logArtifactSha256: cluster.log_artifact_sha256
    };
  }

  async recordDiagnosis(job: DiagnosisJob, result: DiagnosisResult): Promise<void> {
    await this.database.transaction(async (client) => {
      if (!(await completeLease(client, job.outboxId, job.leaseToken))) {
        throw new Error('Diagnosis job lease was lost before completion');
      }
      await client.query(
        `INSERT INTO diagnosis_findings (
          cluster_id, attempt, model, response_id, input_tokens, output_tokens, visible_summary, hypotheses
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          job.clusterId,
          job.attempt,
          result.model,
          result.responseId,
          result.inputTokens,
          result.outputTokens,
          result.diagnosis.visibleSummary,
          JSON.stringify(result.diagnosis.hypotheses)
        ]
      );
      await client.query(
        `UPDATE failure_clusters SET state = 'DIAGNOSED', updated_at = now()
         WHERE id = $1 AND state = 'PENDING'`,
        [job.clusterId]
      );
      await client.query(
        `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
         VALUES ($1, 'diagnosis.proposed', $2::uuid, $3::jsonb)`,
        [
          job.incidentId,
          randomUUID(),
          JSON.stringify({
            clusterId: job.clusterId,
            model: result.model,
            responseId: result.responseId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            nextAction: result.diagnosis.nextAction
          })
        ]
      );
    });
  }

  async failDiagnosis(job: DiagnosisJob, reasonCode: 'model_unavailable' | 'invalid_model_output' | 'evidence_integrity'): Promise<void> {
    await this.database.transaction(async (client) => {
      if (job.attempt >= 3) {
        if (!(await completeLease(client, job.outboxId, job.leaseToken))) {
          return;
        }
        await client.query(`UPDATE failure_clusters SET state = 'NEEDS_REVIEW', updated_at = now() WHERE id = $1`, [job.clusterId]);
        await client.query(
          `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
           VALUES ($1, 'diagnosis.escalated', $2::uuid, $3::jsonb)`,
          [job.incidentId, randomUUID(), JSON.stringify({ clusterId: job.clusterId, reasonCode })]
        );
        return;
      }
      await client.query(
        `UPDATE outbox
         SET leased_until = NULL, lease_token = NULL,
             available_at = now() + (least(300, power(2, attempts))::text || ' seconds')::interval
         WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
        [job.outboxId, job.leaseToken]
      );
    });
  }

  private async claim(topic: string): Promise<{ id: string; leaseToken: string; attempt: number; payload: { incidentId: string; clusterId: string } } | null> {
    return this.database.transaction(async (client) => {
      const leaseToken = randomUUID();
      const claimed = await client.query<{ id: string; attempts: number; payload: { incidentId: string; clusterId: string } }>(
        `WITH next_item AS (
           SELECT id FROM outbox
           WHERE topic = $1 AND completed_at IS NULL AND available_at <= now()
             AND (leased_until IS NULL OR leased_until < now())
           ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE outbox AS target
         SET leased_until = now() + interval '2 minutes', lease_token = $2::uuid, attempts = attempts + 1
         FROM next_item WHERE target.id = next_item.id
         RETURNING target.id, target.attempts, target.payload`,
        [topic, leaseToken]
      );
      if (claimed.rowCount !== 1) {
        return null;
      }
      const row = claimed.rows[0]!;
      return { id: row.id, leaseToken, attempt: row.attempts, payload: row.payload };
    });
  }
}

async function completeLease(
  client: Parameters<Database['transaction']>[0] extends (client: infer T) => Promise<unknown> ? T : never,
  outboxId: string,
  leaseToken: string
): Promise<boolean> {
  const completed = await client.query(
    `UPDATE outbox SET completed_at = now(), leased_until = NULL, lease_token = NULL
     WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
    [outboxId, leaseToken]
  );
  return completed.rowCount === 1;
}
