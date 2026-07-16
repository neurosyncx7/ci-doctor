import test from 'node:test';
import assert from 'node:assert/strict';
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
