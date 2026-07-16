import { randomUUID } from 'node:crypto';
import type { EvidenceRequest } from '../github/evidence-client.js';
import type { Database } from './database.js';

export type IngestionJob = {
  outboxId: string;
  leaseToken: string;
  incidentId: string;
  evidenceRequest: EvidenceRequest;
};

export type IngestedArtifact = {
  kind: string;
  sha256: string;
};

export class PostgresIngestionQueue {
  constructor(private readonly database: Database) {}

  async claimNext(): Promise<IngestionJob | null> {
    return this.database.transaction(async (client) => {
      const leaseToken = randomUUID();
      const claimed = await client.query<{ id: string; incident_id: string }>(
        `WITH next_item AS (
           SELECT id
           FROM outbox
           WHERE topic = 'incident.ingest.requested'
             AND completed_at IS NULL
             AND available_at <= now()
             AND (leased_until IS NULL OR leased_until < now())
           ORDER BY available_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE outbox AS target
         SET leased_until = now() + interval '2 minutes',
             lease_token = $1::uuid,
             attempts = attempts + 1
         FROM next_item
         WHERE target.id = next_item.id
         RETURNING target.id, target.payload->>'incidentId' AS incident_id`,
        [leaseToken]
      );
      if (claimed.rowCount !== 1) {
        return null;
      }

      const outboxId = claimed.rows[0]!.id;
      const incidentId = claimed.rows[0]!.incident_id;
      const context = await client.query<{
        github_installation_id: number;
        repo_full_name: string;
        workflow_run_id: number;
        head_sha: string;
        base_sha: string | null;
      }>(
        `SELECT github_installation_id, repo_full_name, workflow_run_id, head_sha, base_sha
         FROM incidents WHERE id = $1`,
        [incidentId]
      );
      if (context.rowCount !== 1) {
        throw new Error('Outbox event referenced a missing incident');
      }
      const incident = context.rows[0]!;
      return {
        outboxId,
        leaseToken,
        incidentId,
        evidenceRequest: {
          installationId: incident.github_installation_id,
          repoFullName: incident.repo_full_name,
          workflowRunId: incident.workflow_run_id,
          headSha: incident.head_sha,
          baseSha: incident.base_sha
        }
      };
    });
  }

  async complete(job: IngestionJob, artifacts: IngestedArtifact[]): Promise<void> {
    await this.database.transaction(async (client) => {
      const completed = await client.query(
        `UPDATE outbox
         SET completed_at = now(), leased_until = NULL, lease_token = NULL
         WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
        [job.outboxId, job.leaseToken]
      );
      if (completed.rowCount !== 1) {
        throw new Error('Ingestion job lease was lost before completion');
      }
      await client.query(
        `UPDATE incidents
         SET state = 'CLUSTERING_FAILURES', version = version + 1, updated_at = now()
         WHERE id = $1 AND state = 'RECEIVED'`,
        [job.incidentId]
      );
      await client.query(
        `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
         VALUES ($1, 'evidence.ingested', $2::uuid, $3::jsonb)`,
        [job.incidentId, randomUUID(), JSON.stringify({ artifacts })]
      );
      await client.query(
        `INSERT INTO outbox (topic, dedupe_key, payload)
         VALUES ('diagnosis.cluster.requested', $1, $2::jsonb)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [`incident:${job.incidentId}:cluster`, JSON.stringify({ incidentId: job.incidentId })]
      );
    });
  }

  async reschedule(job: IngestionJob, reasonCode: 'github_unavailable' | 'artifact_rejected' | 'internal_error'): Promise<void> {
    await this.database.transaction(async (client) => {
      const released = await client.query(
        `UPDATE outbox
         SET leased_until = NULL,
             lease_token = NULL,
             available_at = now() + (least(300, power(2, attempts))::text || ' seconds')::interval
         WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
        [job.outboxId, job.leaseToken]
      );
      if (released.rowCount !== 1) {
        return;
      }
      await client.query(
        `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
         VALUES ($1, 'evidence.ingest_retry_scheduled', $2::uuid, $3::jsonb)`,
        [job.incidentId, randomUUID(), JSON.stringify({ reasonCode })]
      );
    });
  }
}
