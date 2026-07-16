import type { RepairPolicy } from './policy.js';

export type SandboxCommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export interface RepairSandbox {
  applyPatch(patch: string, policy: RepairPolicy): Promise<void>;
  execute(command: string, policy: RepairPolicy): Promise<SandboxCommandResult>;
  readDiff(): Promise<string>;
  destroy(): Promise<void>;
}

export type RepairTask = {
  incidentId: string;
  clusterId: string;
  attempt: number;
  sourceSha: string;
  policy: RepairPolicy;
  diagnosis: string;
  repositoryContext: string;
  requiredTests: { targeted: string; fullSuite: string };
};

export type RepairProposal = {
  visibleSummary: string;
  patch: string;
  regressionTestIntent: string;
};

export interface RepairAgent {
  propose(task: RepairTask, priorFailures: readonly string[]): Promise<RepairProposal>;
}
