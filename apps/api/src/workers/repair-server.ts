import { loadConfig } from '../config.js';
import { GitHubPullRequestBroker } from '../github/pr-broker.js';
import { createDatabase } from '../persistence/database.js';
import { PostgresRepairQueue } from '../persistence/repair-queue.js';
import { CodexCliPatchProposalAgent } from '../repair/codex-cli-patch-agent.js';
import { GitHubSourceCheckout } from '../repair/github-checkout.js';
import { OpenAiPatchProposalAgent } from '../repair/openai-patch-agent.js';
import { loadRepairRuntimeConfig } from '../repair/repair-runtime-config.js';
import type { RepairAgent } from '../repair/sandbox-contract.js';
import { RepairWorker } from './repair-worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const repairConfig = loadRepairRuntimeConfig();
  const database = createDatabase(config.databaseUrl);
  const agent: RepairAgent = repairConfig.provider === 'codex_cli'
    ? new CodexCliPatchProposalAgent(repairConfig.model)
    : new OpenAiPatchProposalAgent(repairConfig.apiKey!, repairConfig.model);
  const worker = new RepairWorker(
    new PostgresRepairQueue(database),
    new GitHubSourceCheckout(config.githubAppId, config.githubAppPrivateKey),
    agent,
    new GitHubPullRequestBroker(config.githubAppId, config.githubAppPrivateKey)
  );
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });
  while (!stopping) {
    const processed = await worker.runOnce();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await database.close();
}

void main();