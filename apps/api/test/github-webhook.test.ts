import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { FailedWorkflowRun } from '../src/domain/workflow-run.js';
import type { IncidentCreation, IncidentStore, WebhookReceipt } from '../src/persistence/incident-store.js';

const webhookSecret = 'a-very-long-test-secret-that-is-never-a-production-secret';

const config: AppConfig = {
  environment: 'test',
  bindHost: '127.0.0.1',
  port: 4300,
  databaseUrl: 'postgresql://not-used-in-unit-tests',
  githubWebhookSecret: webhookSecret,
  allowedRepositories: new Set(['acme/ci-doctor-fixtures']),
  githubAppId: 1234,
  githubAppPrivateKey: 'test-private-key-not-used-by-the-webhook-route',
  artifactEncryptionKey: Buffer.alloc(32, 7),
  logLevel: 'fatal'
};

test('accepts a signed failed workflow event once and emits an ingest request through the store', async () => {
  const store = new RecordingStore();
  const app = await buildApp({ config, incidentStore: store });
  const body = JSON.stringify(failedWorkflowEvent());

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: signedHeaders(body),
    payload: body
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { status: 'accepted', incidentId: 'inc_test_01' });
  assert.equal(store.receipts.length, 1);
  assert.equal(store.workflows[0]?.repoFullName, 'acme/ci-doctor-fixtures');
  await app.close();
});

test('rejects an unsigned webhook before it reaches storage', async () => {
  const store = new RecordingStore();
  const app = await buildApp({ config, incidentStore: store });
  const body = JSON.stringify(failedWorkflowEvent());

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'workflow_run',
      'x-github-delivery': 'delivery-00000001',
      'x-hub-signature-256': 'sha256:not-a-valid-signature'
    },
    payload: body
  });

  assert.equal(response.statusCode, 401);
  assert.equal(store.receipts.length, 0);
  await app.close();
});

test('ignores a signed successful run without creating an incident', async () => {
  const store = new RecordingStore();
  const app = await buildApp({ config, incidentStore: store });
  const event = failedWorkflowEvent();
  event.workflow_run.conclusion = 'success';
  const body = JSON.stringify(event);

  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: signedHeaders(body),
    payload: body
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { status: 'ignored' });
  assert.equal(store.receipts.length, 0);
  await app.close();
});

function signedHeaders(body: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-github-event': 'workflow_run',
    'x-github-delivery': 'delivery-00000001',
    'x-hub-signature-256': `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`
  };
}

function failedWorkflowEvent(): {
  action: string;
  installation: { id: number };
  repository: { id: number; full_name: string };
  workflow_run: {
    id: number;
    run_attempt: number;
    name: string;
    conclusion: string;
    head_sha: string;
    head_branch: string;
    pull_requests: Array<{ base: { sha: string } }>;
  };
} {
  return {
    action: 'completed',
    installation: { id: 1234 },
    repository: { id: 5678, full_name: 'acme/ci-doctor-fixtures' },
    workflow_run: {
      id: 9999,
      run_attempt: 1,
      name: 'Fixture CI',
      conclusion: 'failure',
      head_sha: 'a'.repeat(40),
      head_branch: 'main',
      pull_requests: [{ base: { sha: 'b'.repeat(40) } }]
    }
  };
}

class RecordingStore implements IncidentStore {
  readonly receipts: WebhookReceipt[] = [];
  readonly workflows: FailedWorkflowRun[] = [];

  async recordFailedWorkflow(receipt: WebhookReceipt, workflow: FailedWorkflowRun): Promise<IncidentCreation> {
    this.receipts.push(receipt);
    this.workflows.push(workflow);
    return { incidentId: 'inc_test_01', created: true };
  }

  async ping(): Promise<void> {}
}
