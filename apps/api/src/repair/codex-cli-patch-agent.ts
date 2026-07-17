import { CodexCliRunner } from '../agent-runtime/codex-cli-runner.js';
import { finalizeProposal, plannerInput, plannerInstructions, repairProposalJsonSchema, repairProposalSchema } from './openai-patch-agent.js';
import type { RepairAgent, RepairProposal, RepairTask } from './sandbox-contract.js';

export class CodexCliPatchProposalAgent implements RepairAgent {
  private readonly runner: CodexCliRunner;

  constructor(model: string) {
    this.runner = new CodexCliRunner(model);
  }

  async propose(task: RepairTask, priorFailures: readonly string[]): Promise<RepairProposal> {
    const result = await this.runner.runJson<unknown>({
      schema: repairProposalJsonSchema,
      prompt: [
        plannerInstructions(),
        '<untrusted-repair-context>',
        JSON.stringify(plannerInput(task, priorFailures)),
        '</untrusted-repair-context>'
      ].join('\n')
    });
    return finalizeProposal(repairProposalSchema.parse(result.value), task);
  }
}