import { GitHubPullRequestBroker } from '../github/pr-broker.js';
import { PostgresRepairQueue, type RepairDiagnosis } from '../persistence/repair-queue.js';
import { RepairAttemptLoop } from '../repair/attempt-loop.js';
import { DockerRepairSandbox } from '../repair/docker-sandbox.js';
import { GitHubSourceCheckout } from '../repair/github-checkout.js';
import type { RepairPolicy } from '../repair/policy.js';
import type { RepairAgent } from '../repair/sandbox-contract.js';

export class RepairWorker {
  constructor(
    private readonly queue: PostgresRepairQueue,
    private readonly checkout: GitHubSourceCheckout,
    private readonly agent: RepairAgent,
    private readonly broker: GitHubPullRequestBroker
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claimNext();
    if (!job) return false;
    if (job.diagnoses.length === 0 || job.diagnoses.some((item) => item.nextAction !== 'EXECUTE_REPAIR')) {
      await this.queue.decline(job, 'diagnosis_not_actionable');
      return true;
    }
    let source: Awaited<ReturnType<GitHubSourceCheckout['checkout']>> | undefined;
    try {
      source = await this.checkout.checkout({
        installationId: job.installationId,
        repository: job.repository,
        sourceSha: job.sourceSha
      });
      const requiredTests = selectRequiredTests(job.diagnoses, source.policy, source.packageScripts);
      if (!requiredTests) {
        await this.queue.decline(job, 'policy_missing');
        return true;
      }
      const loop = new RepairAttemptLoop(
        this.agent,
        new DockerRepairSandbox({ workspacePath: source.path, allowWorkspaceWrite: true })
      );
      const outcomes = await loop.run({
        incidentId: job.incidentId,
        clusterId: job.diagnoses.map((item) => item.clusterId).join(','),
        attempt: 1,
        sourceSha: job.sourceSha,
        workspacePath: source.path,
        policy: source.policy,
        diagnosis: job.diagnoses.map((item, index) => `${index + 1}. ${item.visibleSummary}`).join('\n'),
        repositoryContext: source.context,
        requiredTests
      });
      const final = outcomes.at(-1);
      if (final?.state !== 'VALIDATED' || !final.diff) {
        await this.queue.complete(job, outcomes, null);
        return true;
      }
      const changes = await source.changesFromDiff(final.diff);
      const branchName = `ci-doctor/${job.incidentId.replace(/-/g, '').slice(0, 16)}`;
      const pullRequest = await this.broker.publish({
        installationId: job.installationId,
        repoFullName: job.repository,
        baseSha: job.sourceSha,
        baseBranch: job.baseBranch,
        branchName,
        title: `CI Doctor: repair failed ${job.repository} checks`,
        commitMessage: `fix: repair failed CI checks (${job.incidentId.slice(0, 8)})`,
        body: pullRequestBody(job.diagnoses, outcomes),
        changes
      });
      await this.queue.complete(job, outcomes, pullRequest);
      return true;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'ci_doctor.repair_worker_error',
        incidentId: job.incidentId,
        reason: safeRuntimeReason(error)
      }));
      await this.queue.reschedule(job, classifyRepairFailure(error));
      return true;
    } finally {
      await source?.destroy();
    }
  }
}

function selectRequiredTests(
  diagnoses: readonly RepairDiagnosis[],
  policy: RepairPolicy,
  packageScripts: Readonly<Record<string, string>>
): { targeted: readonly string[]; fullSuite: string } | null {
  const fullSuite = policy.allowedCommands.find((command) => command === 'npm.cmd test' || command === 'npm test');
  if (!fullSuite) return null;
  const targeted = diagnoses.flatMap((diagnosis) => {
    const match = /test[\\/]([A-Za-z0-9._-]+)\.test\.[A-Za-z0-9]+/i.exec(diagnosis.errorExcerpt);
    if (!match) return [];
    const filename = `test/${match[1]}.test.js`;
    const script = Object.entries(packageScripts).find(([, command]) => command.replaceAll('\\', '/').includes(filename))?.[0];
    if (!script) return [];
    const candidate = `npm.cmd run ${script}`;
    return policy.allowedCommands.includes(candidate) ? [candidate] : [];
  });
  const uniqueTargeted = [...new Set(targeted)];
  if (uniqueTargeted.length === diagnoses.length) {
    return { targeted: uniqueTargeted, fullSuite };
  }

  // GitHub sometimes emits one suite-level failure instead of individual test paths.
  // In that case, validate every explicitly allowlisted focused test command rather
  // than guessing a command from model output or reducing the validation standard.
  const hasUnattributedFailure = diagnoses.some((diagnosis) => diagnosis.testName === 'unattributed CI failure');
  const fallbackTargeted = policy.allowedCommands.filter((command) => {
    const match = /^npm(?:\.cmd)? run ([A-Za-z0-9:_-]+)$/.exec(command);
    return match !== null && match[1]!.startsWith('test:') && Object.hasOwn(packageScripts, match[1]!);
  });
  return hasUnattributedFailure && fallbackTargeted.length > 0
    ? { targeted: fallbackTargeted, fullSuite }
    : null;
}

function pullRequestBody(diagnoses: readonly RepairDiagnosis[], outcomes: readonly { proposalSummary: string; targeted?: readonly { command: string; exitCode: number }[]; fullSuite?: { command: string; exitCode: number } }[]): string {
  const final = outcomes.at(-1);
  return [
    '## CI Doctor validated repair',
    '',
    'This pull request was produced only after a signed failing workflow was captured, evidence was diagnosed, and the proposed diff passed a network-sealed Docker validation.',
    '',
    '### Evidence-backed diagnoses',
    ...diagnoses.map((item) => `- ${item.visibleSummary}`),
    '',
    '### Validation',
    ...(final?.targeted ?? []).map((item) => `- Focused: ${item.command} (exit ${item.exitCode})`),
    `- Full suite: ${final?.fullSuite?.command ?? 'not recorded'} (exit ${final?.fullSuite?.exitCode ?? 'not recorded'})`,
    '',
    `Repair summary: ${final?.proposalSummary ?? 'No model summary recorded.'}`
  ].join('\n');
}

function classifyRepairFailure(error: unknown): 'source_unavailable' | 'repair_runtime_error' | 'broker_unavailable' {
  if (error instanceof Error && /Git source checkout|Repository checkout/.test(error.message)) return 'source_unavailable';
  if (error instanceof Error && /GitHub write request/.test(error.message)) return 'broker_unavailable';
  return 'repair_runtime_error';
}

function safeRuntimeReason(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  return error.message
    .replace(/[\r\n]/g, ' ')
    .replace(/(?:token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 240);
}
