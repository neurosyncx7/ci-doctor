import { loadConfig } from '../config.js';
import { CodexCliDiagnosisModel } from '../diagnosis/codex-cli-diagnosis-model.js';
import { type DiagnosisModel } from '../diagnosis/contract.js';
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
  const model: DiagnosisModel = diagnosisConfig.provider === 'codex_cli'
    ? new CodexCliDiagnosisModel(diagnosisConfig.model)
    : new OpenAiDiagnosisModel(diagnosisConfig.apiKey!, diagnosisConfig.model);
  const clusterWorker = new ClusterWorker(queue, artifacts);
  const diagnosisWorker = new DiagnosisWorker(queue, artifacts, model);

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