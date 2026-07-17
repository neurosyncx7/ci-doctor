import type { Database } from '../persistence/database.js';

export type SafeIncidentEvent = {
  sequence: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
};

export type LiveIncidentSummary = {
  incidentId: string;
  state: string;
  repository: string;
  workflow: string;
  sourceSha: string;
  createdAt: string;
  updatedAt: string;
  diagnoses: Array<{ clusterId: string; testName: string; state: string; visibleSummary: string | null; nextAction: string | null }>;
  repair: {
    state: string;
    branchName: string | null;
    pullRequest: { number: number; url: string } | null;
    attempts: Array<{ attempt: number; state: string; reasonCode: string | null; patchSha256: string | null; targetedExitCodes: number[] | null; fullSuiteExitCode: number | null; visibleSummary: string }>;
  } | null;
  events: SafeIncidentEvent[];
};

export interface DashboardIncidentReadStore {
  latest(): Promise<LiveIncidentSummary | null>;
  byId(incidentId: string): Promise<LiveIncidentSummary | null>;
}

export class PostgresDashboardIncidentReadStore implements DashboardIncidentReadStore {
  constructor(private readonly database: Database) {}

  async latest(): Promise<LiveIncidentSummary | null> {
    const result = await this.database.pool.query<{ id: string }>('SELECT id FROM incidents ORDER BY created_at DESC LIMIT 1');
    return result.rowCount === 1 ? this.byId(result.rows[0]!.id) : null;
  }

  async byId(incidentId: string): Promise<LiveIncidentSummary | null> {
    const incident = await this.database.pool.query<{
      id: string; state: string; repo_full_name: string; workflow_name: string; head_sha: string; created_at: Date; updated_at: Date;
    }>(
      `SELECT id, state, repo_full_name, workflow_name, head_sha, created_at, updated_at
       FROM incidents WHERE id = $1`,
      [incidentId]
    );
    if (incident.rowCount !== 1) return null;
    const row = incident.rows[0]!;
    const [diagnoses, repair, events] = await Promise.all([
      this.readDiagnoses(row.id),
      this.readRepair(row.id),
      this.readEvents(row.id)
    ]);
    return {
      incidentId: row.id,
      state: row.state,
      repository: row.repo_full_name,
      workflow: row.workflow_name,
      sourceSha: row.head_sha,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      diagnoses,
      repair,
      events
    };
  }

  private async readDiagnoses(incidentId: string): Promise<LiveIncidentSummary['diagnoses']> {
    const result = await this.database.pool.query<{
      cluster_id: string; test_name: string; state: string; visible_summary: string | null; next_action: string | null;
    }>(
      `SELECT fc.id AS cluster_id, fc.test_name, fc.state, df.visible_summary, df.next_action
       FROM failure_clusters fc
       LEFT JOIN LATERAL (
         SELECT visible_summary, next_action FROM diagnosis_findings
         WHERE cluster_id = fc.id ORDER BY attempt DESC LIMIT 1
       ) df ON true
       WHERE fc.incident_id = $1
       ORDER BY fc.created_at`,
      [incidentId]
    );
    return result.rows.map((item) => ({
      clusterId: item.cluster_id,
      testName: item.test_name,
      state: item.state,
      visibleSummary: item.visible_summary,
      nextAction: item.next_action
    }));
  }

  private async readRepair(incidentId: string): Promise<LiveIncidentSummary['repair']> {
    const run = await this.database.pool.query<{
      id: string; state: string; branch_name: string | null; pull_request_number: number | null; pull_request_url: string | null;
    }>(
      `SELECT id, state, branch_name, pull_request_number, pull_request_url
       FROM repair_runs WHERE incident_id = $1`,
      [incidentId]
    );
    if (run.rowCount !== 1) return null;
    const current = run.rows[0]!;
    const attempts = await this.database.pool.query<{
      attempt: number; state: string; reason_code: string | null; patch_sha256: string; targeted_exit_codes: unknown; full_suite_exit_code: number | null; visible_summary: string;
    }>(
      `SELECT attempt, state, reason_code, patch_sha256, targeted_exit_codes, full_suite_exit_code, visible_summary
       FROM repair_attempts WHERE repair_run_id = $1 ORDER BY attempt`,
      [current.id]
    );
    return {
      state: current.state,
      branchName: current.branch_name,
      pullRequest: current.pull_request_number && current.pull_request_url
        ? { number: current.pull_request_number, url: current.pull_request_url }
        : null,
      attempts: attempts.rows.map((item) => ({
        attempt: item.attempt,
        state: item.state,
        reasonCode: item.reason_code,
        patchSha256: item.patch_sha256 || null,
        targetedExitCodes: numberArray(item.targeted_exit_codes),
        fullSuiteExitCode: item.full_suite_exit_code,
        visibleSummary: item.visible_summary
      }))
    };
  }

  private async readEvents(incidentId: string): Promise<SafeIncidentEvent[]> {
    const result = await this.database.pool.query<{ sequence: string; event_type: string; payload: unknown; created_at: Date }>(
      `SELECT sequence, event_type, payload, created_at
       FROM incident_events WHERE incident_id = $1 ORDER BY sequence DESC LIMIT 80`,
      [incidentId]
    );
    return result.rows.reverse().map((item) => ({
      sequence: Number(item.sequence),
      type: item.event_type,
      at: item.created_at.toISOString(),
      payload: safePayload(item.event_type, item.payload)
    }));
  }
}

function numberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : null;
}

function safePayload(type: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  const allowed: Record<string, readonly string[]> = {
    'workflow.failure.detected': ['repository', 'workflowRunId', 'runAttempt', 'headSha', 'source'],
    'evidence.ingested': ['artifacts'],
    'failure.clustered': ['clusterId', 'testName', 'fingerprint'],
    'diagnosis.proposed': ['clusterId', 'model', 'inputTokens', 'outputTokens', 'nextAction'],
    'repair.attempt.recorded': ['attempt', 'state', 'reasonCode', 'patchSha256', 'targetedExitCodes', 'fullSuiteExitCode'],
    'pull_request.opened': ['number', 'url', 'branchName'],
    'repair.declined': ['reasonCode'],
    'repair.retry_scheduled': ['reasonCode', 'attempt'],
    'evidence.ingest_retry_scheduled': ['reasonCode'],
    'diagnosis.escalated': ['clusterId', 'reasonCode'],
    'failure.clustering_escalated': ['reasonCode']
  };
  const output: Record<string, unknown> = {};
  for (const key of allowed[type] ?? []) {
    const candidate = payload[key];
    if (isSafeValue(candidate)) output[key] = candidate;
  }
  return output;
}

function isSafeValue(value: unknown): value is string | number | boolean | null | readonly unknown[] {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  return Array.isArray(value) && value.every((item) => isSafeValue(item));
}
