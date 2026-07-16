/**
 * Read model for the first verified CI Doctor run. It is a safe public summary:
 * no raw logs, credentials, model chain-of-thought, or encrypted evidence is exposed.
 * The next persistence increment replaces this seeded proof record with incident queries.
 */
export const verifiedIncident = {
  incidentId: 'inc_7f3a•••c21',
  status: 'RESOLVED',
  repository: 'neurosyncx7/ci-doctor-fixtures',
  workflow: 'Fixture CI · Node 22 fixture tests',
  pullRequest: { number: 3, url: 'https://github.com/neurosyncx7/ci-doctor-fixtures/pull/3' },
  sourceSha: 'b2bafea',
  repairSha: '917499f',
  validation: { focused: '4 / 4', fullSuite: '8 / 8', sandbox: 'Docker · network sealed' },
  failures: [
    { label: 'Null display name', detail: 'Profile import called trim() on null.', patch: "displayName?.trim() || 'Anonymous'" },
    { label: 'Exact page boundary', detail: '10 items / 10 per page yielded 0 pages.', patch: 'Math.ceil(totalItems / pageSize)' },
    { label: 'Async stale response', detail: 'Older request could overwrite newer search results.', patch: 'requestId === latestRequestId' },
    { label: 'Numeric status', detail: 'Third-party status 503 had no toLowerCase().', patch: 'String(event.status).toLowerCase()' }
  ],
  safeguards: ['GitHub webhook signature verified', 'Evidence encrypted at rest', 'Sandbox network disabled', 'Protected paths denied', 'PR broker holds write token']
} as const;
