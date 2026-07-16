import { loadConfig } from '../config.js';
import { loadDiagnosisRuntimeConfig } from '../diagnosis/diagnosis-runtime-config.js';
import { OpenAiDiagnosisModel } from '../diagnosis/openai-diagnosis-model.js';
import { EncryptedArtifactStore } from '../persistence/artifact-store.js';
import { createDatabase } from '../persistence/database.js';
import { PostgresDiagnosisQueue } from '../persistence/diagnosis-queue.js';
import { ClusterWorker, DiagnosisWorker } from './diagnosis-workers.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const diagnosisConfig = loadDiagnosisRuntimeConfig();
  const database = createDatabase(config.databaseUrl);
  const artifacts = new EncryptedArtifactStore(database, config.artifactEncryptionKey);
  const queue = new PostgresDiagnosisQueue(database);
  const clusterWorker = new ClusterWorker(queue, artifacts);
  const diagnosisWorker = new DiagnosisWorker(
    queue,
    artifacts,
    new OpenAiDiagnosisModel(diagnosisConfig.apiKey, diagnosisConfig.model)
  );

  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    const clustered = await clusterWorker.runOnce();
    const diagnoses = await Promise.all(
      Array.from({ length: diagnosisConfig.concurrency }, () => diagnosisWorker.runOnce())
    );
    if (!clustered && !diagnoses.some(Boolean)) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  await database.close();
}

void main();
