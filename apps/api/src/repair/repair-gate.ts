import { assertAllowedCommand, assertPatchWithinPolicy } from './policy.js';
import type { RepairSandbox, RepairTask, SandboxCommandResult } from './sandbox-contract.js';

export async function validateRepairAttempt(
  sandbox: RepairSandbox,
  task: RepairTask
): Promise<{ diff: string; targeted: readonly SandboxCommandResult[]; fullSuite: SandboxCommandResult }> {
  if (task.requiredTests.targeted.length === 0) {
    throw new Error('At least one focused regression test is required');
  }
  for (const command of task.requiredTests.targeted) {
    assertAllowedCommand(command, task.policy);
  }
  assertAllowedCommand(task.requiredTests.fullSuite, task.policy);
  const diff = await sandbox.readDiff();
  assertPatchWithinPolicy(diff, task.policy);
  const targeted: SandboxCommandResult[] = [];
  for (const command of task.requiredTests.targeted) {
    const result = await sandbox.execute(command, task.policy);
    targeted.push(result);
    if (result.exitCode !== 0) {
      throw new Error('Targeted regression test did not pass');
    }
  }
  const fullSuite = await sandbox.execute(task.requiredTests.fullSuite, task.policy);
  if (fullSuite.exitCode !== 0) {
    throw new Error('Full suite did not pass');
  }
  return { diff, targeted, fullSuite };
}
