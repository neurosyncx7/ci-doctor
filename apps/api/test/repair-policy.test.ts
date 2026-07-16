import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPatchWithinPolicy, repairPolicySchema } from '../src/repair/policy.js';

const policy = repairPolicySchema.parse({
  allowedCommands: ['npm.cmd run test:pagination', 'npm.cmd test'],
  autonomousWritePaths: ['src/**', 'test/**'],
  protectedPaths: ['.github/**', 'package.json'],
  repairBudget: { maxAttempts: 3, maxChangedFiles: 8, maxChangedLines: 500, maxWallSeconds: 720 },
  validation: { requireRegressionTest: true, requireTargetedTest: true, requireFullSuite: true }
});

test('refuses an autonomous patch that changes workflow configuration', () => {
  assert.throws(
    () => assertPatchWithinPolicy('diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+run: skip', policy),
    /protected path/
  );
});

test('permits a narrow source-and-regression-test patch', () => {
  assert.doesNotThrow(() => assertPatchWithinPolicy(
    'diff --git a/src/pagination.js b/src/pagination.js\n-old\n+new\ndiff --git a/test/pagination.test.js b/test/pagination.test.js\n+test',
    policy
  ));
});
