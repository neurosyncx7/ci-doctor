import { z } from 'zod';

export const repairPolicySchema = z.object({
  allowedCommands: z.array(z.string().min(1)).min(1),
  autonomousWritePaths: z.array(z.string().min(1)).min(1),
  protectedPaths: z.array(z.string().min(1)).min(1),
  repairBudget: z.object({
    maxAttempts: z.number().int().min(1).max(3),
    maxChangedFiles: z.number().int().min(1).max(20),
    maxChangedLines: z.number().int().min(1).max(1000),
    maxWallSeconds: z.number().int().min(30).max(1800)
  }),
  validation: z.object({
    requireRegressionTest: z.literal(true),
    requireTargetedTest: z.literal(true),
    requireFullSuite: z.literal(true)
  })
}).strict();

export type RepairPolicy = z.infer<typeof repairPolicySchema>;

export function assertAllowedCommand(command: string, policy: RepairPolicy): void {
  if (!policy.allowedCommands.includes(command)) {
    throw new Error(`Command is outside the repository allowlist: ${command}`);
  }
}

export function assertPatchWithinPolicy(diff: string, policy: RepairPolicy): void {
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]!);
  if (files.length === 0 || files.length > policy.repairBudget.maxChangedFiles) {
    throw new Error('Patch file count is outside the repair budget');
  }
  const changedLines = diff.split('\n').filter((line) => /^[+-](?![+-])/.test(line)).length;
  if (changedLines > policy.repairBudget.maxChangedLines) {
    throw new Error('Patch line count exceeds the repair budget');
  }
  for (const file of files) {
    if (policy.protectedPaths.some((pattern) => matches(file, pattern))) {
      throw new Error(`Patch touches a protected path: ${file}`);
    }
    if (!policy.autonomousWritePaths.some((pattern) => matches(file, pattern))) {
      throw new Error(`Patch touches a path outside autonomous scope: ${file}`);
    }
  }
}

function matches(path: string, pattern: string): boolean {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : path === pattern;
}
