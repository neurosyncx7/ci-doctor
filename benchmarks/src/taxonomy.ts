export const taxonomy = ['symptom_patching', 'test_gaming', 'scope_blindness', 'give_up_too_early', 'environment_blocked', 'unknown'] as const;
export type FailureTaxonomy = (typeof taxonomy)[number];

export function classifyFailure(input: { visibleTrace: string; diff: string; testExitCode: number | null }): FailureTaxonomy {
  const trace = input.visibleTrace.toLowerCase();
  const diff = input.diff.toLowerCase();
  if (input.testExitCode === null) return 'environment_blocked';
  if (/disable|skip|todo\(|only\(|assert\.true\(true\)/.test(diff)) return 'test_gaming';
  if (/stack trace|line \d+|quick fix/.test(trace) && !/root cause|adapter|shared|config|state/.test(trace)) return 'symptom_patching';
  if (/did not inspect|not found|unable to locate/.test(trace)) return 'scope_blindness';
  if (/would|could|suggest|not enough time|budget/.test(trace)) return 'give_up_too_early';
  return 'unknown';
}
