import type { RepairPolicy } from './policy.js';

export type SandboxCommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export interface RepairSandbox {
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
  requiredTests: { targeted: string; fullSuite: string };
};
