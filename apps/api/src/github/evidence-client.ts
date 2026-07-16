import { createAppAuth } from '@octokit/auth-app';
import { redactLogText } from '../security/log-redaction.js';

type FailedJob = {
  id: number;
  name: string;
  conclusion: string | null;
};

export type EvidenceRequest = {
  installationId: number;
  repoFullName: string;
  workflowRunId: number;
  headSha: string;
  baseSha: string | null;
};

export type CollectedEvidence = {
  jobs: FailedJob[];
  jobLogs: Array<{ jobId: number; name: string; text: string; truncated: boolean }>;
  diff: Record<string, unknown> | null;
};

type GitHubResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type GitHubFetch = (input: string, init: RequestInit) => Promise<GitHubResponse>;

export class GitHubEvidenceClient {
  private readonly authenticate;

  constructor(
    appId: number,
    privateKey: string,
    private readonly fetcher: GitHubFetch = fetch as unknown as GitHubFetch
  ) {
    this.authenticate = createAppAuth({ appId, privateKey });
  }

  async collect(request: EvidenceRequest): Promise<CollectedEvidence> {
    const headers = await this.authorizationHeaders(request.installationId);
    const jobsResponse = await this.requestJson(
      `/repos/${request.repoFullName}/actions/runs/${request.workflowRunId}/jobs?filter=latest&per_page=100`,
      headers
    );
    const jobs = parseFailedJobs(jobsResponse);
    const jobLogs = await Promise.all(jobs.map(async (job) => ({
      jobId: job.id,
      name: job.name,
      ...(await this.fetchJobLog(request.repoFullName, job.id, headers))
    })));

    const baseSha = request.baseSha ?? await this.fetchFirstParent(request.repoFullName, request.headSha, headers);
    const diff = baseSha
      ? await this.requestJson(`/repos/${request.repoFullName}/compare/${baseSha}...${request.headSha}`, headers)
      : null;
    return { jobs, jobLogs, diff: isRecord(diff) ? diff : null };
  }

  private async authorizationHeaders(installationId: number): Promise<Record<string, string>> {
    const auth = await this.authenticate({ type: 'installation', installationId });
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${auth.token}`,
      'x-github-api-version': '2022-11-28'
    };
  }

  private async fetchJobLog(
    repoFullName: string,
    jobId: number,
    headers: Record<string, string>
  ): Promise<{ text: string; truncated: boolean }> {
    const response = await this.fetcher(`https://api.github.com/repos/${repoFullName}/actions/jobs/${jobId}/logs`, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(`GitHub job-log retrieval failed with status ${response.status}`);
    }
    const rawLog = await response.text();
    const limit = 1_000_000;
    const truncated = rawLog.length > limit;
    return { text: redactLogText(rawLog.slice(0, limit)), truncated };
  }

  private async fetchFirstParent(
    repoFullName: string,
    headSha: string,
    headers: Record<string, string>
  ): Promise<string | null> {
    const commit = await this.requestJson(`/repos/${repoFullName}/commits/${headSha}`, headers);
    if (!isRecord(commit) || !Array.isArray(commit.parents)) {
      return null;
    }
    const parent = commit.parents[0];
    return isRecord(parent) && typeof parent.sha === 'string' && /^[0-9a-f]{40}$/i.test(parent.sha)
      ? parent.sha.toLowerCase()
      : null;
  }

  private async requestJson(path: string, headers: Record<string, string>): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}`);
    }
    return response.json();
  }
}

function parseFailedJobs(value: unknown): FailedJob[] {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    throw new Error('GitHub jobs response did not contain a jobs array');
  }
  return value.jobs.flatMap((job): FailedJob[] => {
    if (!isRecord(job) || typeof job.id !== 'number' || typeof job.name !== 'string') {
      return [];
    }
    return job.conclusion === 'failure' ? [{ id: job.id, name: job.name, conclusion: 'failure' }] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
