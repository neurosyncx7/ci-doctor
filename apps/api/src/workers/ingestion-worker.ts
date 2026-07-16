import type { GitHubEvidenceClient } from '../github/evidence-client.js';
import type { EncryptedArtifactStore } from '../persistence/artifact-store.js';
import type { IngestedArtifact, PostgresIngestionQueue } from '../persistence/ingestion-queue.js';

export class IngestionWorker {
  constructor(
    private readonly queue: PostgresIngestionQueue,
    private readonly github: GitHubEvidenceClient,
    private readonly artifacts: EncryptedArtifactStore
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claimNext();
    if (!job) {
      return false;
    }

    try {
      const evidence = await this.github.collect(job.evidenceRequest);
      const saved: IngestedArtifact[] = [];
      saved.push(await this.saveJson(job.incidentId, 'workflow_jobs', { jobs: evidence.jobs }));
      for (const jobLog of evidence.jobLogs) {
        const annotatedLog = [
          '[ci-doctor-log-metadata]',
          `job_id: ${jobLog.jobId}`,
          `job_name: ${jobLog.name}`,
          `truncated: ${jobLog.truncated}`,
          '',
          jobLog.text
        ].join('\n');
        saved.push(await this.saveText(job.incidentId, 'job_log', annotatedLog));
      }
      if (evidence.diff) {
        saved.push(await this.saveJson(job.incidentId, 'trigger_diff', evidence.diff));
      }
      await this.queue.complete(job, saved);
      return true;
    } catch (error) {
      await this.queue.reschedule(job, classifyIngestionFailure(error));
      return true;
    }
  }

  private async saveJson(
    incidentId: string,
    kind: 'workflow_jobs' | 'trigger_diff',
    content: Record<string, unknown>
  ): Promise<IngestedArtifact> {
    const artifact = await this.artifacts.put({
      incidentId,
      kind,
      contentType: 'application/json',
      content: Buffer.from(JSON.stringify(content), 'utf8')
    });
    return { kind, sha256: artifact.sha256 };
  }

  private async saveText(incidentId: string, kind: 'job_log', content: string): Promise<IngestedArtifact> {
    const artifact = await this.artifacts.put({
      incidentId,
      kind,
      contentType: 'text/plain',
      content: Buffer.from(content, 'utf8')
    });
    return { kind, sha256: artifact.sha256 };
  }
}

function classifyIngestionFailure(error: unknown): 'github_unavailable' | 'artifact_rejected' | 'internal_error' {
  if (error instanceof Error && error.message.startsWith('GitHub')) {
    return 'github_unavailable';
  }
  if (error instanceof Error && error.message.includes('Artifact exceeds')) {
    return 'artifact_rejected';
  }
  return 'internal_error';
}
