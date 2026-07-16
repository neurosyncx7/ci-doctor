import { createHash } from 'node:crypto';
import { assertPatchWithinPolicy } from './policy.js';
import { validateRepairAttempt } from './repair-gate.js';
import type { RepairAgent, RepairSandbox, RepairTask, SandboxCommandResult } from './sandbox-contract.js';

export type RepairAttemptOutcome = {
  attempt: number;
  proposalSummary: string;
  patchSha256: string;
  state: 'VALIDATED' | 'REJECTED' | 'VALIDATION_FAILED' | 'BUDGET_EXHAUSTED';
  reasonCode?: 'duplicate_patch' | 'policy_rejected' | 'targeted_test_failed' | 'full_suite_failed' | 'agent_failed';
  targeted?: SandboxCommandResult;
  fullSuite?: SandboxCommandResult;
};

export class RepairAttemptLoop {
  constructor(
    private readonly agent: RepairAgent,
    private readonly sandbox: RepairSandbox
  ) {}

  async run(task: RepairTask): Promise<RepairAttemptOutcome[]> {
    const outcomes: RepairAttemptOutcome[] = [];
    const seenPatchHashes = new Set<string>();
    const priorFailures: string[] = [];

    try {
      for (let attempt = 1; attempt <= task.policy.repairBudget.maxAttempts; attempt += 1) {
        let proposal;
        try {
          proposal = await this.agent.propose({ ...task, attempt }, priorFailures);
        } catch (error) {
          outcomes.push({
            attempt,
            proposalSummary: 'Repair agent did not return a proposal.',
            patchSha256: '',
            state: attempt === task.policy.repairBudget.maxAttempts ? 'BUDGET_EXHAUSTED' : 'REJECTED',
            reasonCode: 'agent_failed'
          });
          priorFailures.push(`agent_failed:${toSafeReason(error)}`);
          continue;
        }

        const patchSha256 = createHash('sha256').update(proposal.patch).digest('hex');
        if (seenPatchHashes.has(patchSha256)) {
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: 'REJECTED',
            reasonCode: 'duplicate_patch'
          });
          break;
        }
        seenPatchHashes.add(patchSha256);

        try {
          assertPatchWithinPolicy(proposal.patch, task.policy);
          await this.sandbox.applyPatch(proposal.patch, task.policy);
        } catch (error) {
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: attempt === task.policy.repairBudget.maxAttempts ? 'BUDGET_EXHAUSTED' : 'REJECTED',
            reasonCode: 'policy_rejected'
          });
          priorFailures.push(`policy_rejected:${toSafeReason(error)}`);
          continue;
        }

        try {
          const validated = await validateRepairAttempt(this.sandbox, task);
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: 'VALIDATED',
            targeted: validated.targeted,
            fullSuite: validated.fullSuite
          });
          return outcomes;
        } catch (error) {
          const reasonCode = error instanceof Error && error.message.includes('Targeted')
            ? 'targeted_test_failed'
            : 'full_suite_failed';
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: attempt === task.policy.repairBudget.maxAttempts ? 'BUDGET_EXHAUSTED' : 'VALIDATION_FAILED',
            reasonCode
          });
          priorFailures.push(`${reasonCode}:${toSafeReason(error)}`);
        }
      }
      return outcomes;
    } finally {
      await this.sandbox.destroy();
    }
  }
}

function toSafeReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  return error.message.replace(/[\r\n]/g, ' ').slice(0, 240);
}
