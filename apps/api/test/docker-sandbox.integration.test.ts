import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DockerRepairSandbox } from '../src/repair/docker-sandbox.js';
import { repairPolicySchema } from '../src/repair/policy.js';

const runDockerIntegration = process.env.CI_DOCTOR_DOCKER_TEST === '1';

test('runs an allowlisted fixture test in a network-isolated read-only container', { skip: !runDockerIntegration }, async () => {
  const policy = repairPolicySchema.parse({
    allowedCommands: ['npm test'],
    autonomousWritePaths: ['src/**', 'test/**'],
    protectedPaths: ['.github/**', 'package.json'],
    repairBudget: { maxAttempts: 3, maxChangedFiles: 8, maxChangedLines: 500, maxWallSeconds: 120 },
    validation: { requireRegressionTest: true, requireTargetedTest: true, requireFullSuite: true }
  });
  const sandbox = new DockerRepairSandbox({
    workspacePath: `${process.cwd()}/fixtures/ci-doctor-fixtures`,
    dockerBinary: process.env.DOCKER_BIN
  });
  const result = await sandbox.execute('npm test', policy);
  assert.equal(result.exitCode, 1, 'the fixture must remain genuinely failing before repair');
  assert.match(result.stdout + result.stderr, /2 !== 3/);
});

test('applies an approved patch only in a disposable writable workspace', { skip: !runDockerIntegration }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ci-doctor-sandbox-'));
  try {
    await cp(`${process.cwd()}/fixtures/ci-doctor-fixtures`, workspace, { recursive: true });
    const policy = repairPolicySchema.parse({
      allowedCommands: ['node --test test/pagination.test.js'],
      autonomousWritePaths: ['src/**', 'test/**'],
      protectedPaths: ['.github/**', 'package.json', 'ci-doctor.policy.json'],
      repairBudget: { maxAttempts: 3, maxChangedFiles: 8, maxChangedLines: 500, maxWallSeconds: 120 },
      validation: { requireRegressionTest: true, requireTargetedTest: true, requireFullSuite: true }
    });
    const sandbox = new DockerRepairSandbox({
      workspacePath: workspace,
      dockerBinary: process.env.DOCKER_BIN,
      allowWorkspaceWrite: true
    });
    await sandbox.applyPatch([
      'diff --git a/src/pagination.js b/src/pagination.js',
      '--- a/src/pagination.js',
      '+++ b/src/pagination.js',
      '@@ -1,10 +1,10 @@',
      ' function pageCount(totalItems, pageSize) {',
      '   if (totalItems === 0) {',
      '     return 0;',
      '   }',
      ' ',
      '-  return Math.floor((totalItems - 1) / pageSize);',
      '+  return Math.ceil(totalItems / pageSize);',
      ' }',
      ' ',
      ' module.exports = { pageCount };',
      ''
    ].join('\n'), policy);
    const diff = await sandbox.readDiff();
    assert.match(diff, /Math\.ceil/);
    const result = await sandbox.execute('node --test test/pagination.test.js', policy);
    assert.equal(result.exitCode, 0, result.stderr);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
