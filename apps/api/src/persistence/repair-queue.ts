import { randomUUID } from 'node:crypto';
import type { RepairAttemptOutcome } from '../repair/attempt-loop.js';
import type { Database } from './database.js';

export type RepairDiagnosis = {
  clusterId: string;
  testName: string;
  errorExcerpt: string;
  visibleSummary: string;
  nextAction: 'EXECUTE_REPAIR' | 'NEEDS_MORE_EVIDENCE' | 'ESCALATE_HUMAN' | null;
};

export type RepairJob = {
  outboxId: string;
  leaseToken: string;
  outboxAttempt: number;
  repairRunId: string;
  incidentId: string;
  installationId: number;
  repository: string;
  sourceSha: string;
  baseBranch: string;
  diagnoses: readonly RepairDiagnosis[];
};

export type PullRequestRecord = { number: number; url: string; branchName: string };

export class PostgresRepairQueue {
  constructor(private readonly database: Database) {}

  async claimNext(): Promise<RepairJob | null> {
    return this.database.transaction(async (client) => {
      const leaseToken = randomUUID();
      const claimed = await client.query<{ id: string; attempts: number; incident_id: string }>(
        `WITH next_item AS (
           SELECT id
           FROM outbox
           WHERE topic = 'repair.work.requested' AND completed_at IS NULL AND available_at <= now()
             AND (leased_until IS NULL OR leased_until < now())
           ORDER BY available_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE outbox AS target
         SET leased_until = now() + interval '15 minutes', lease_token = $1::uuid, attempts = attempts + 1
         FROM next_item
         WHERE target.id = next_item.id
         RETURNING target.id, target.attempts, target.payload->>'incidentId' AS incident_id`,
        [leaseToken]
      );
      if (claimed.rowCount !== 1) return null;
      const item = claimed.rows[0]!;
      const incident = await client.query<{
        github_installation_id: number; repo_full_name: string; head_sha: string; head_branch: string | null;
      }>(
        `SELECT github_installation_id, repo_full_name, head_sha, head_branch
         FROM incidents WHERE id = $1`,
        [item.incident_id]
      );
      if (incident.rowCount !== 1) throw new Error('Repair work item referenced a missing incident');
      const context = incident.rows[0]!;
      const run = await client.query<{ id: string }>(
        `INSERT INTO repair_runs (incident_id, state, source_sha, lease_token, leased_until, attempts, updated_at)
         VALUES ($1, 'RUNNING', $2, $3::uuid, now() + interval '15 minutes', 1, now())
         ON CONFLICT (incident_id) DO UPDATE
           SET state = 'RUNNING', lease_token = EXCLUDED.lease_token,
               leased_until = EXCLUDED.leased_until, attempts = repair_runs.attempts + 1, updated_at = now()
         RETURNING id`,
        [item.incident_id, context.head_sha, leaseToken]
      );
      await client.query(
        `UPDATE incidents SET state = 'PATCHING', version = version + 1, updated_at = now()
         WHERE id = $1 AND state IN ('DIAGNOSING', 'REPRODUCING')`,
        [item.incident_id]
      );
      const diagnoses = await client.query<RepairDiagnosis>(
        `SELECT fc.id AS "clusterId", fc.test_name AS "testName", fc.error_excerpt AS "errorExcerpt",
                df.visible_summary AS "visibleSummary", df.next_action AS "nextAction"
         FROM failure_clusters fc
         JOIN LATERAL (
           SELECT visible_summary, next_action FROM diagnosis_findings
           WHERE cluster_id = fc.id ORDER BY attempt DESC LIMIT 1
         ) df ON true
         WHERE fc.incident_id = $1
         ORDER BY fc.created_at`,
        [item.incident_id]
      );
      return {
        outboxId: item.id,
        leaseToken,
        outboxAttempt: item.attempts,
        repairRunId: run.rows[0]!.id,
        incidentId: item.incident_id,
        installationId: context.github_installation_id,
        repository: context.repo_full_name,
        sourceSha: context.head_sha,
        baseBranch: context.head_branch ?? 'main',
        diagnoses: diagnoses.rows
      };
    });
  }

  async decline(job: RepairJob, reasonCode: 'diagnosis_not_actionable' | 'policy_missing' | 'unsupported_runtime'): Promise<void> {
    await this.database.transaction(async (client) => {
      if (!(await completeLease(client, job.outboxId, job.leaseToken))) return;
      await client.query(
        `UPDATE repair_runs SET state = 'NEEDS_REVIEW', lease_token = NULL, leased_until = NULL, updated_at = now()
         WHERE id = $1 AND lease_token = $2::uuid`,
        [job.repairRunId, job.leaseToken]
      );
      await client.query(
        `UPDATE incidents SET state = 'NEEDS_REVIEW', version = version + 1, updated_at = now() WHERE id = $1`,
        [job.incidentId]
      );
      await recordEvent(client, job.incidentId, 'repair.declined', { reasonCode });
    });
  }

  async complete(job: RepairJob, outcomes: readonly RepairAttemptOutcome[], pullRequest: PullRequestRecord | null): Promise<void> {
    await this.database.transaction(async (client) => {
      if (!(await completeLease(client, job.outboxId, job.leaseToken))) throw new Error('Repair job lease was lost before completion');
      for (const outcome of outcomes) {
        await client.query(
          `INSERT INTO repair_attempts (
             repair_run_id, attempt, state, reason_code, patch_sha256, visible_summary, targeted_exit_codes, full_suite_exit_code
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           ON CONFLICT (repair_run_id, attempt) DO NOTHING`,
          [
            job.repairRunId, outcome.attempt, outcome.state, outcome.reasonCode ?? null,
            outcome.patchSha256, outcome.proposalSummary,
            outcome.targeted ? JSON.stringify(outcome.targeted.map((item) => item.exitCode)) : null,
            outcome.fullSuite?.exitCode ?? null
          ]
        );
        await recordEvent(client, job.incidentId, 'repair.attempt.recorded', {
          attempt: outcome.attempt,
          state: outcome.state,
          reasonCode: outcome.reasonCode ?? null,
          patchSha256: outcome.patchSha256 || null,
          targetedExitCodes: outcome.targeted?.map((item) => item.exitCode) ?? null,
          fullSuiteExitCode: outcome.fullSuite?.exitCode ?? null
        });
      }
      const final = outcomes.at(-1);
      const runState = pullRequest ? 'PR_OPENED'
        : final?.state === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED'
          : final?.state === 'VALIDATION_FAILED' ? 'VALIDATION_FAILED'
            : 'NEEDS_REVIEW';
      const incidentState = pullRequest ? 'PR_OPENED'
        : final?.state === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED'
          : final?.state === 'VALIDATION_FAILED' ? 'VALIDATION_FAILED'
            : 'NEEDS_REVIEW';
      await client.query(
        `UPDATE repair_runs
         SET state = $1::repair_run_state, branch_name = $2, pull_request_number = $3, pull_request_url = $4,
             lease_token = NULL, leased_until = NULL, updated_at = now()
         WHERE id = $5 AND lease_token = $6::uuid`,
        [runState, pullRequest?.branchName ?? null, pullRequest?.number ?? null, pullRequest?.url ?? null, job.repairRunId, job.leaseToken]
      );
      await client.query(
        `UPDATE incidents SET state = $1::incident_state, version = version + 1, updated_at = now() WHERE id = $2`,
        [incidentState, job.incidentId]
      );
      if (pullRequest) await recordEvent(client, job.incidentId, 'pull_request.opened', pullRequest);
    });
  }

  async reschedule(job: RepairJob, reasonCode: 'source_unavailable' | 'repair_runtime_error' | 'broker_unavailable'): Promise<void> {
    await this.database.transaction(async (client) => {
      if (job.outboxAttempt >= 3) {
        if (!(await completeLease(client, job.outboxId, job.leaseToken))) return;
        await client.query(
          `UPDATE repair_runs SET state = 'NEEDS_REVIEW', lease_token = NULL, leased_until = NULL, updated_at = now()
           WHERE id = $1 AND lease_token = $2::uuid`,
          [job.repairRunId, job.leaseToken]
        );
        await client.query(
          `UPDATE incidents SET state = 'NEEDS_REVIEW', version = version + 1, updated_at = now() WHERE id = $1`,
          [job.incidentId]
        );
        await recordEvent(client, job.incidentId, 'repair.declined', { reasonCode: 'unsupported_runtime' });
        return;
      }
      const released = await client.query(
        `UPDATE outbox
         SET leased_until = NULL, lease_token = NULL,
             available_at = now() + (least(300, power(2, attempts))::text || ' seconds')::interval
         WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
        [job.outboxId, job.leaseToken]
      );
      if (released.rowCount !== 1) return;
      await client.query(
        `UPDATE repair_runs SET state = 'PENDING', lease_token = NULL, leased_until = NULL, updated_at = now()
         WHERE id = $1 AND lease_token = $2::uuid`,
        [job.repairRunId, job.leaseToken]
      );
      await recordEvent(client, job.incidentId, 'repair.retry_scheduled', { reasonCode, attempt: job.outboxAttempt });
    });
  }
}

async function completeLease(client: Parameters<Database['transaction']>[0] extends (value: infer T) => Promise<unknown> ? T : never, outboxId: string, leaseToken: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE outbox SET completed_at = now(), leased_until = NULL, lease_token = NULL
     WHERE id = $1 AND lease_token = $2::uuid AND completed_at IS NULL`,
    [outboxId, leaseToken]
  );
  return result.rowCount === 1;
}

async function recordEvent(client: Parameters<Database['transaction']>[0] extends (value: infer T) => Promise<unknown> ? T : never, incidentId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO incident_events (incident_id, event_type, correlation_id, payload)
     VALUES ($1, $2, $3::uuid, $4::jsonb)`,
    [incidentId, eventType, randomUUID(), JSON.stringify(payload)]
  );
}
