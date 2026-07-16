import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFailureClusters } from '../src/diagnosis/failure-clustering.js';

test('clusters the live fixture suite into four independent failure work items', () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const execution = spawnSync(process.execPath, [
    '--test',
    'test/profile.test.js',
    'test/pagination.test.js',
    'test/search-session.test.js',
    'test/status-label.test.js'
  ], {
    cwd: `${process.cwd()}/fixtures/ci-doctor-fixtures`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(
    execution.status,
    1,
    `fixture suite must remain red before CI Doctor repairs it\nstdout:\n${execution.stdout}\nstderr:\n${execution.stderr}`
  );

  const clusters = extractFailureClusters(`${execution.stdout}\n${execution.stderr}`, 'a'.repeat(64));
  assert.deepEqual(
    clusters.map((cluster) => cluster.testName).sort(),
    [
      'includes the final partial page after an exact page boundary',
      'keeps the latest search result when an older request finishes last',
      'normalizes numeric statuses returned by a third-party provider',
      'uses a safe fallback when an imported profile has no display name'
    ].sort()
  );
  assert.equal(new Set(clusters.map((cluster) => cluster.fingerprint)).size, 4);
});
