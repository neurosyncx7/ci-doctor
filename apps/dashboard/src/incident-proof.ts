/**
 * Immutable public snapshot exported from a real CI Doctor run on 2026-07-17.
 * It is deliberately labelled recorded proof in the UI whenever the live API is unavailable.
 * No raw logs, credentials, or hidden model reasoning are included.
 */
export const recordedIncidentProof = {
  incidentId: '7491174d-8ea0-4c35-b423-27b78c6f892a',
  state: 'PR_OPENED',
  repository: 'neurosyncx7/ci-doctor-fixtures',
  workflow: 'Fixture CI',
  sourceSha: 'b2bafeafb636ca5009dfa69da7e144ec2f2e1ea9',
  diagnoses: [{
    testName: 'unattributed CI failure',
    state: 'DIAGNOSED',
    visibleSummary: 'The Node 22 fixture suite deterministically failed in four independent behaviors: pagination, null profile labels, stale search responses, and numeric status normalization.',
    nextAction: 'EXECUTE_REPAIR'
  }],
  repair: {
    state: 'PR_OPENED',
    branchName: 'ci-doctor/7491174d8ea04c35',
    pullRequest: { number: 4, url: 'https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4' },
    attempts: [{
      attempt: 1,
      state: 'VALIDATED',
      reasonCode: null,
      patchSha256: '6fa3d792dd0aa6383263b7ec92349004db06bc0eb01a90c90da4cc4880aacdec',
      targetedExitCodes: [0, 0, 0, 0],
      fullSuiteExitCode: 0,
      visibleSummary: 'Fixes all four diagnosed behaviors and adds an exact-boundary pagination regression case.'
    }]
  },
  events: [
    { sequence: 87, type: 'workflow.failure.detected', at: '2026-07-17T18:33:03.885Z', payload: { repository: 'neurosyncx7/ci-doctor-fixtures', workflowRunId: 29527100048, runAttempt: 20, headSha: 'b2bafeafb636ca5009dfa69da7e144ec2f2e1ea9', source: 'github.workflow_run' } },
    { sequence: 88, type: 'evidence.ingested', at: '2026-07-17T18:33:11.303Z', payload: {} },
    { sequence: 89, type: 'failure.clustered', at: '2026-07-17T18:33:11.798Z', payload: { testName: 'unattributed CI failure' } },
    { sequence: 90, type: 'diagnosis.proposed', at: '2026-07-17T18:33:30.693Z', payload: { model: 'codex-cli:gpt-5.6-terra', nextAction: 'EXECUTE_REPAIR' } },
    { sequence: 91, type: 'repair.attempt.recorded', at: '2026-07-17T18:34:12.359Z', payload: { attempt: 1, state: 'VALIDATED', targetedExitCodes: [0, 0, 0, 0], fullSuiteExitCode: 0 } },
    { sequence: 92, type: 'pull_request.opened', at: '2026-07-17T18:34:12.359Z', payload: { number: 4, url: 'https://github.com/neurosyncx7/ci-doctor-fixtures/pull/4', branchName: 'ci-doctor/7491174d8ea04c35' } }
  ]
} as const;
