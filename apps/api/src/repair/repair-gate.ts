import { assertAllowedCommand, assertPatchWithinPolicy } from './policy.js';
import type { RepairSandbox, RepairTask, SandboxCommandResult } from './sandbox-contract.js';

export async function validateRepairAttempt(
  sandbox: RepairSandbox,
  task: RepairTask
): Promise<{ diff: string; targeted: SandboxCommandResult; fullSuite: SandboxCommandResult }> {
  assertAllowedCommand(task.requiredTests.targeted, task.policy);
  assertAllowedCommand(task.requiredTests.fullSuite, task.policy);
  const diff = await sandbox.readDiff();
  assertPatchWithinPolicy(diff, task.policy);
  const targeted = await sandbox.execute(task.requiredTests.targeted, task.policy);
  if (targeted.exitCode !== 0) {
    throw new Error('Targeted regression test did not pass');
  }
  const fullSuite = await sandbox.execute(task.requiredTests.fullSuite, task.policy);
  if (fullSuite.exitCode !== 0) {
    throw new Error('Full suite did not pass');
  }
  return { diff, targeted, fullSuite };
}
