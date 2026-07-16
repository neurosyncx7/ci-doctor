import { loadConfig } from '../config.js';
import { GitHubEvidenceClient } from '../github/evidence-client.js';
import { EncryptedArtifactStore } from '../persistence/artifact-store.js';
import { createDatabase } from '../persistence/database.js';
import { PostgresIngestionQueue } from '../persistence/ingestion-queue.js';
import { IngestionWorker } from './ingestion-worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const worker = new IngestionWorker(
    new PostgresIngestionQueue(database),
    new GitHubEvidenceClient(config.githubAppId, config.githubAppPrivateKey),
    new EncryptedArtifactStore(database, config.artifactEncryptionKey)
  );

  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    const processed = await worker.runOnce();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  await database.close();
}

void main();
