import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { repairPolicySchema } from '../src/repair/policy.js';
import { compileStructuredPatch } from '../src/repair/structured-patch.js';

const policy = repairPolicySchema.parse({
  allowedCommands: ['npm.cmd test'],
  autonomousWritePaths: ['src/**', 'test/**'],
  protectedPaths: ['.github/**', 'package.json', 'ci-doctor.policy.json'],
  repairBudget: { maxAttempts: 3, maxChangedFiles: 8, maxChangedLines: 500, maxWallSeconds: 120 },
  validation: { requireRegressionTest: true, requireTargetedTest: true, requireFullSuite: true }
});
const fixture = resolve(process.cwd(), 'fixtures/ci-doctor-fixtures');

test('canonicalizes exact source and regression-test replacements into an allowlisted diff', async () => {
  const patch = await compileStructuredPatch(fixture, [
    {
      path: 'src/pagination.js',
      expectedText: 'return Math.floor((totalItems - 1) / pageSize);',
      replacementText: 'return Math.ceil(totalItems / pageSize);'
    },
    {
      path: 'test/pagination.test.js',
      expectedText: "  assert.equal(pageCount(21, 10), 3);",
      replacementText: "  assert.equal(pageCount(21, 10), 3);\n  assert.equal(pageCount(10, 10), 1);"
    }
  ], policy);
  assert.match(patch, /^diff --git a\/src\/pagination\.js b\/src\/pagination\.js/m);
  assert.match(patch, /^diff --git a\/test\/pagination\.test\.js b\/test\/pagination\.test\.js/m);
  assert.doesNotMatch(patch, /package\.json/);
});

test('rejects an edit whose exact source anchor is absent', async () => {
  await assert.rejects(() => compileStructuredPatch(fixture, [
    { path: 'src/pagination.js', expectedText: 'does not exist', replacementText: 'anything' }
  ], policy), /occur exactly once/);
});
test('emits adjacent file headers for a multi-file unified patch', async () => {
  const patch = await compileStructuredPatch(fixture, [
    {
      path: 'src/pagination.js',
      expectedText: 'return Math.floor((totalItems - 1) / pageSize);',
      replacementText: 'return Math.ceil(totalItems / pageSize);'
    },
    {
      path: 'test/pagination.test.js',
      expectedText: "  assert.equal(pageCount(21, 10), 3);",
      replacementText: "  assert.equal(pageCount(21, 10), 3);\n  assert.equal(pageCount(10, 10), 1);"
    }
  ], policy);
  assert.doesNotMatch(patch, /\n\ndiff --git/);
  assert.doesNotMatch(patch, /\n\+\n(?:diff --git|$)/);
  assert.match(patch, /diff --git a\/test\/pagination\.test\.js/);
});
