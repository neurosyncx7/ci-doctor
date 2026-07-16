import { ZodError } from 'zod';
import { validateEvidenceReferences, type DiagnosisModel } from '../diagnosis/contract.js';
import { extractFailureClusters } from '../diagnosis/failure-clustering.js';
import type { EncryptedArtifactStore } from '../persistence/artifact-store.js';
import type { PostgresDiagnosisQueue } from '../persistence/diagnosis-queue.js';

export class ClusterWorker {
  constructor(
    private readonly queue: PostgresDiagnosisQueue,
    private readonly artifacts: EncryptedArtifactStore
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claimClusterJob();
    if (!job) {
      return false;
    }
    try {
      const artifacts = await this.artifacts.listForIncident(job.incidentId);
      const clusters = artifacts
        .filter((artifact) => artifact.kind === 'job_log')
        .flatMap((artifact) => extractFailureClusters(artifact.content.toString('utf8'), artifact.sha256));
      await this.queue.saveClusters(job, clusters);
      return true;
    } catch {
      await this.queue.failCluster(job);
      return true;
    }
  }
}

export class DiagnosisWorker {
  constructor(
    private readonly queue: PostgresDiagnosisQueue,
    private readonly artifacts: EncryptedArtifactStore,
    private readonly model: DiagnosisModel
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claimDiagnosisJob();
    if (!job) {
      return false;
    }
    try {
      const artifacts = await this.artifacts.listForIncident(job.incidentId);
      const evidence = artifacts
        .filter((artifact) => artifact.sha256 === job.logArtifactSha256 || artifact.kind === 'trigger_diff')
        .map((artifact) => ({
          artifactSha256: artifact.sha256,
          kind: artifact.kind,
          content: artifact.content.toString('utf8').slice(0, 24_000)
        }));
      const result = await this.model.diagnose({
        incidentId: job.incidentId,
        clusterId: job.clusterId,
        testName: job.testName,
        errorExcerpt: job.errorExcerpt,
        evidence
      });
      validateEvidenceReferences(result.diagnosis, new Set(evidence.map((item) => item.artifactSha256)));
      await this.queue.recordDiagnosis(job, result);
      return true;
    } catch (error) {
      await this.queue.failDiagnosis(job, classifyDiagnosisFailure(error));
      return true;
    }
  }
}

function classifyDiagnosisFailure(error: unknown): 'model_unavailable' | 'invalid_model_output' | 'evidence_integrity' {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return 'invalid_model_output';
  }
  if (error instanceof Error && error.message.includes('artifact')) {
    return 'evidence_integrity';
  }
  return 'model_unavailable';
}
