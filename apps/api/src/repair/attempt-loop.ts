import { createHash } from 'node:crypto';
import { assertPatchWithinPolicy } from './policy.js';
import { validateRepairAttempt } from './repair-gate.js';
import type { RepairAgent, RepairSandbox, RepairTask, SandboxCommandResult } from './sandbox-contract.js';

export type RepairAttemptOutcome = {
  attempt: number;
  proposalSummary: string;
  patchSha256: string;
  state: 'VALIDATED' | 'REJECTED' | 'VALIDATION_FAILED' | 'BUDGET_EXHAUSTED';
  reasonCode?: 'duplicate_patch' | 'patch_file_budget' | 'patch_line_budget' | 'protected_path' | 'outside_write_scope' | 'invalid_structured_edit' | 'sandbox_patch_rejected' | 'targeted_test_failed' | 'full_suite_failed' | 'agent_failed';
  diff?: string;
  targeted?: readonly SandboxCommandResult[];
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
          const safeReason = toSafeReason(error);
          console.warn(JSON.stringify({
            event: 'ci_doctor.repair_agent_rejected',
            incidentId: task.incidentId,
            attempt,
            reason: safeReason
          }));
          outcomes.push({
            attempt,
            proposalSummary: 'Repair agent did not return a proposal.',
            patchSha256: '',
            state: attempt === task.policy.repairBudget.maxAttempts ? 'BUDGET_EXHAUSTED' : 'REJECTED',
            reasonCode: 'agent_failed'
          });
          priorFailures.push(`agent_failed:${safeReason}`);
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
          const reasonCode = classifyPatchRejection(error);
          console.warn(JSON.stringify({
            event: 'ci_doctor.repair_policy_rejected',
            incidentId: task.incidentId,
            attempt,
            reasonCode
          }));
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: attempt === task.policy.repairBudget.maxAttempts ? 'BUDGET_EXHAUSTED' : 'REJECTED',
            reasonCode
          });
          // Give the next bounded attempt an actionable category, never a raw sandbox error.
          priorFailures.push(`patch_rejected:${reasonCode}`);
          continue;
        }

        try {
          const validated = await validateRepairAttempt(this.sandbox, task);
          outcomes.push({
            attempt,
            proposalSummary: proposal.visibleSummary,
            patchSha256,
            state: 'VALIDATED',
            diff: validated.diff,
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

/** Maps internal policy/sandbox errors to a small safe taxonomy for telemetry and retries. */
function classifyPatchRejection(error: unknown): NonNullable<RepairAttemptOutcome['reasonCode']> {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('file count') || message.includes('edit count')) return 'patch_file_budget';
  if (message.includes('line count')) return 'patch_line_budget';
  if (message.includes('protected path')) return 'protected_path';
  if (message.includes('outside autonomous scope')) return 'outside_write_scope';
  if (/Structured repair|expected text|regular files|resolved outside/i.test(message)) return 'invalid_structured_edit';
  return 'sandbox_patch_rejected';
}