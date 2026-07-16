import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FailedWorkflowRun } from '../domain/workflow-run.js';
import type { Database } from './database.js';

export type WebhookReceipt = {
  deliveryId: string;
  eventName: string;
  rawBody: Buffer;
};

export type IncidentCreation = {
  incidentId: string;
  created: boolean;
};

export interface IncidentStore {
  recordFailedWorkflow(receipt: WebhookReceipt, workflow: FailedWorkflowRun): Promise<IncidentCreation>;
  ping(): Promise<void>;
}

export class PostgresIncidentStore implements IncidentStore {
  constructor(private readonly database: Database) {}

  async ping(): Promise<void> {
    await this.database.pool.query('SELECT 1');
  }

  async recordFailedWorkflow(receipt: WebhookReceipt, workflow: FailedWorkflowRun): Promise<IncidentCreation> {
    return this.database.transaction(async (client) => {
      const accepted = await insertWebhookDelivery(client, receipt);
      if (!accepted) {
        return { incidentId: '', created: false };
      }

      const incident = await createOrGetIncident(client, workflow);
      if (!incident.created) {
        return incident;
      }

      const correlationId = randomUUID();
      const payload = {
        repository: workflow.repoFullName,
        workflowRunId: workflow.workflowRunId,
        runAttempt: workflow.runAttempt,
        headSha: workflow.headSha,
        source: 'github.workflow_run'
      };

      await client.query(
        `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
         VALUES ($1, 'workflow.failure.detected', $2, $3::jsonb)`,
        [incident.incidentId, correlationId, JSON.stringify(payload)]
      );
      await client.query(
        `INSERT INTO outbox (topic, dedupe_key, payload)
         VALUES ('incident.ingest.requested', $1, $2::jsonb)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [`incident:${incident.incidentId}:ingest`, JSON.stringify({ incidentId: incident.incidentId, correlationId })]
      );
      return incident;
    });
  }
}

async function insertWebhookDelivery(client: PoolClient, receipt: WebhookReceipt): Promise<boolean> {
  const payloadHash = createHash('sha256').update(receipt.rawBody).digest('hex');
  const result = await client.query(
    `INSERT INTO webhook_deliveries (delivery_id, event_name, payload_sha256)
     VALUES ($1, $2, $3)
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING id`,
    [receipt.deliveryId, receipt.eventName, payloadHash]
  );
  return result.rowCount === 1;
}

async function createOrGetIncident(client: PoolClient, workflow: FailedWorkflowRun): Promise<IncidentCreation> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO incidents (
       github_repo_id, github_installation_id, repo_full_name, workflow_run_id,
       run_attempt, workflow_name, head_sha, base_sha
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (github_repo_id, workflow_run_id, run_attempt) DO NOTHING
     RETURNING id`,
    [
      workflow.githubRepoId,
      workflow.githubInstallationId,
      workflow.repoFullName,
      workflow.workflowRunId,
      workflow.runAttempt,
      workflow.workflowName,
      workflow.headSha,
      workflow.baseSha
    ]
  );
  if (inserted.rowCount === 1) {
    return { incidentId: inserted.rows[0]!.id, created: true };
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM incidents
     WHERE github_repo_id = $1 AND workflow_run_id = $2 AND run_attempt = $3`,
    [workflow.githubRepoId, workflow.workflowRunId, workflow.runAttempt]
  );
  return { incidentId: existing.rows[0]!.id, created: false };
}
