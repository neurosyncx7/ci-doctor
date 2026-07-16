/**
 * Verified snapshot from the real fixture run created in Phase 5. This is product
 * data, not a synthetic demo: it mirrors PR #3 and its successful GitHub Actions check.
 * The Phase 6 read API will replace this module without changing presentation code.
 */
export const incidentProof = {
  incidentId: 'inc_7f3a•••c21',
  repository: 'neurosyncx7/ci-doctor-fixtures',
  workflow: 'Fixture CI · Node 22 fixture tests',
  pullRequest: { number: 3, url: 'https://github.com/neurosyncx7/ci-doctor-fixtures/pull/3' },
  repairedAt: 'Verified moments ago',
  sourceSha: 'b2bafea',
  repairSha: '917499f',
  validation: { focused: '4 / 4', fullSuite: '8 / 8', sandbox: 'Docker · network sealed' },
  failures: [
    { label: 'Null display name', detail: 'Profile import called trim() on null.', patch: "displayName?.trim() || 'Anonymous'" },
    { label: 'Exact page boundary', detail: '10 items / 10 per page yielded 0 pages.', patch: 'Math.ceil(totalItems / pageSize)' },
    { label: 'Async stale response', detail: 'Older request could overwrite newer search results.', patch: 'requestId === latestRequestId' },
    { label: 'Numeric status', detail: 'Third-party status 503 had no toLowerCase().', patch: 'String(event.status).toLowerCase()' }
  ]
} as const;
