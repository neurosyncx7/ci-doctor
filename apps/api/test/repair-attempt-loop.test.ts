import test from 'node:test';
import assert from 'node:assert/strict';
import { RepairAttemptLoop } from '../src/repair/attempt-loop.js';
import { repairPolicySchema } from '../src/repair/policy.js';
import type { RepairAgent, RepairSandbox, RepairTask, SandboxCommandResult } from '../src/repair/sandbox-contract.js';

const policy = repairPolicySchema.parse({
  allowedCommands: ['npm test:targeted', 'npm test'],
  autonomousWritePaths: ['src/**', 'test/**'],
  protectedPaths: ['.github/**', 'package.json'],
  repairBudget: { maxAttempts: 3, maxChangedFiles: 8, maxChangedLines: 500, maxWallSeconds: 120 },
  validation: { requireRegressionTest: true, requireTargetedTest: true, requireFullSuite: true }
});

const task: RepairTask = {
  incidentId: 'incident-1',
  clusterId: 'cluster-1',
  attempt: 1,
  sourceSha: 'a'.repeat(40),
  workspacePath: '.',
  policy,
  diagnosis: 'Exact multiples are undercounted.',
  repositoryContext: 'src/pagination.js and test/pagination.test.js',
  requiredTests: { targeted: ['npm test:targeted'], fullSuite: 'npm test' }
};

const permittedPatch = [
  'diff --git a/src/pagination.js b/src/pagination.js',
  '--- a/src/pagination.js',
  '+++ b/src/pagination.js',
  '@@ -1 +1 @@',
  '-return Math.floor((totalItems - 1) / pageSize);',
  '+return Math.ceil(totalItems / pageSize);',
  'diff --git a/test/pagination.test.js b/test/pagination.test.js',
  '--- a/test/pagination.test.js',
  '+++ b/test/pagination.test.js',
  '@@ -1 +1 @@',
  '+assert.equal(pageCount(10, 10), 1);'
].join('\n');

test('accepts only a policy-approved patch with recorded targeted and full validation', async () => {
  const sandbox = new FakeSandbox();
  const agent: RepairAgent = { propose: async () => ({ visibleSummary: 'Fixed page count.', regressionTestIntent: 'Exact multiple.', patch: permittedPatch }) };
  const outcomes = await new RepairAttemptLoop(agent, sandbox).run(task);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.state, 'VALIDATED');
  assert.deepEqual(sandbox.commands, ['npm test:targeted', 'npm test']);
  assert.equal(sandbox.destroyed, true);
});

test('stops a looping agent that returns an identical patch after validation failure', async () => {
  const sandbox = new FakeSandbox('npm test:targeted');
  const agent: RepairAgent = { propose: async () => ({ visibleSummary: 'Retrying page count.', regressionTestIntent: 'Exact multiple.', patch: permittedPatch }) };
  const outcomes = await new RepairAttemptLoop(agent, sandbox).run(task);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.state, 'VALIDATION_FAILED');
  assert.equal(outcomes[1]?.reasonCode, 'duplicate_patch');
  assert.equal(sandbox.applyCalls, 1);
  assert.equal(sandbox.destroyed, true);
});

class FakeSandbox implements RepairSandbox {
  readonly commands: string[] = [];
  destroyed = false;
  applyCalls = 0;
  private patch = '';

  constructor(private readonly failingCommand?: string) {}

  async applyPatch(patch: string): Promise<void> {
    this.applyCalls += 1;
    this.patch = patch;
  }

  async execute(command: string): Promise<SandboxCommandResult> {
    this.commands.push(command);
    return { command, exitCode: command === this.failingCommand ? 1 : 0, stdout: '', stderr: '', durationMs: 1 };
  }

  async readDiff(): Promise<string> {
    return this.patch;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

test('records a safe policy category and feeds that category—not raw sandbox text—to the next attempt', async () => {
  const invalidPatch = Array.from({ length: 9 }, (_, index) => [
    `diff --git a/src/file-${index}.js b/src/file-${index}.js`,
    `--- a/src/file-${index}.js`,
    `+++ b/src/file-${index}.js`,
    '@@ -1 +1 @@',
    '-old',
    '+new'
  ].join('\n')).join('\n');
  const observedFailures: string[][] = [];
  const agent: RepairAgent = {
    propose: async (_task, priorFailures) => {
      observedFailures.push([...priorFailures]);
      return { visibleSummary: 'A bounded proposal.', regressionTestIntent: 'Policy test.', patch: `${invalidPatch}\n# attempt ${observedFailures.length}` };
    }
  };
  const outcomes = await new RepairAttemptLoop(agent, new FakeSandbox()).run(task);
  assert.equal(outcomes[0]?.reasonCode, 'patch_file_budget');
  assert.deepEqual(observedFailures[1], ['patch_rejected:patch_file_budget']);
});