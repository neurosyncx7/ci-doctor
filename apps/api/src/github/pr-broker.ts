import { createAppAuth } from '@octokit/auth-app';

export type ValidatedFileChange = {
  path: string;
  content: Buffer;
};

export type PublishPullRequestInput = {
  installationId: number;
  repoFullName: string;
  baseSha: string;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
  commitMessage: string;
  changes: readonly ValidatedFileChange[];
};

export type PublishedPullRequest = {
  number: number;
  url: string;
  branchName: string;
  commitSha: string;
  reused: boolean;
};

type GitHubResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type GitHubFetch = (input: string, init: RequestInit) => Promise<GitHubResponse>;
type InstallationHeadersProvider = (installationId: number) => Promise<Record<string, string>>;

/**
 * The only component allowed to write to GitHub. It accepts already-validated file
 * content rather than a shell command or a sandbox path, and is safe to retry:
 * an open PR for the deterministic branch is reused before any Git object is created.
 */
export class GitHubPullRequestBroker {
  private readonly authenticate;

  constructor(
    appId: number,
    privateKey: string,
    private readonly fetcher: GitHubFetch = fetch as unknown as GitHubFetch,
    private readonly installationHeadersProvider?: InstallationHeadersProvider
  ) {
    this.authenticate = createAppAuth({ appId, privateKey });
  }

  async publish(input: PublishPullRequestInput): Promise<PublishedPullRequest> {
    validateInput(input);
    const headers = await this.authorizationHeaders(input.installationId);
    const existing = await this.findOpenPullRequest(input, headers);
    if (existing) {
      return { ...existing, branchName: input.branchName, commitSha: input.baseSha, reused: true };
    }

    const treeSha = await this.getCommitTree(input.repoFullName, input.baseSha, headers);
    const treeEntries = await Promise.all(input.changes.map(async (change) => ({
      path: change.path,
      mode: '100644',
      type: 'blob',
      sha: await this.createBlob(input.repoFullName, change.content, headers)
    })));
    const nextTreeSha = await this.createTree(input.repoFullName, treeSha, treeEntries, headers);
    const commitSha = await this.createCommit(input.repoFullName, input.commitMessage, nextTreeSha, input.baseSha, headers);
    await this.createBranch(input.repoFullName, input.branchName, commitSha, headers);
    const pullRequest = await this.requestJson(`/repos/${input.repoFullName}/pulls`, headers, {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.branchName, base: input.baseBranch })
    });
    const parsed = parsePullRequest(pullRequest);
    return { ...parsed, branchName: input.branchName, commitSha, reused: false };
  }

  private async authorizationHeaders(installationId: number): Promise<Record<string, string>> {
    if (this.installationHeadersProvider) {
      return this.installationHeadersProvider(installationId);
    }
    const auth = await this.authenticate({ type: 'installation', installationId });
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    };
  }

  private async findOpenPullRequest(input: PublishPullRequestInput, headers: Record<string, string>): Promise<Omit<PublishedPullRequest, 'branchName' | 'commitSha' | 'reused'> | null> {
    const [owner] = input.repoFullName.split('/');
    const value = await this.requestJson(
      `/repos/${input.repoFullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branchName}`)}`,
      headers
    );
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }
    return parsePullRequest(value[0]);
  }

  private async getCommitTree(repo: string, commitSha: string, headers: Record<string, string>): Promise<string> {
    const value = await this.requestJson(`/repos/${repo}/git/commits/${commitSha}`, headers);
    if (!isRecord(value) || !isRecord(value.tree) || typeof value.tree.sha !== 'string') {
      throw new Error('GitHub commit response did not include a tree SHA');
    }
    return value.tree.sha;
  }

  private async createBlob(repo: string, content: Buffer, headers: Record<string, string>): Promise<string> {
    const value = await this.requestJson(`/repos/${repo}/git/blobs`, headers, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' })
    });
    return parseSha(value, 'blob');
  }

  private async createTree(repo: string, baseTree: string, tree: readonly Record<string, string>[], headers: Record<string, string>): Promise<string> {
    const value = await this.requestJson(`/repos/${repo}/git/trees`, headers, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree })
    });
    return parseSha(value, 'tree');
  }

  private async createCommit(repo: string, message: string, tree: string, parent: string, headers: Record<string, string>): Promise<string> {
    const value = await this.requestJson(`/repos/${repo}/git/commits`, headers, {
      method: 'POST',
      body: JSON.stringify({ message, tree, parents: [parent] })
    });
    return parseSha(value, 'commit');
  }

  private async createBranch(repo: string, branch: string, sha: string, headers: Record<string, string>): Promise<void> {
    await this.requestJson(`/repos/${repo}/git/refs`, headers, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    });
  }

  private async requestJson(path: string, headers: Record<string, string>, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub write request failed with status ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json();
  }
}

function validateInput(input: PublishPullRequestInput): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repoFullName)) {
    throw new Error('Repository name is invalid');
  }
  if (!/^[0-9a-f]{40}$/i.test(input.baseSha)) {
    throw new Error('Base SHA is invalid');
  }
  if (!/^ci-doctor\/[a-z0-9-]+$/.test(input.branchName)) {
    throw new Error('Branch must use the deterministic ci-doctor/ namespace');
  }
  if (input.changes.length === 0 || input.changes.length > 20) {
    throw new Error('PR change set is outside the broker limit');
  }
  for (const change of input.changes) {
    if (change.path.startsWith('/') || change.path.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(change.path)) {
      throw new Error('PR change path is invalid');
    }
    if (change.content.byteLength > 1_000_000) {
      throw new Error('PR file content is outside the broker limit');
    }
  }
}

function parseSha(value: unknown, kind: string): string {
  if (!isRecord(value) || typeof value.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(value.sha)) {
    throw new Error(`GitHub ${kind} response did not include a valid SHA`);
  }
  return value.sha.toLowerCase();
}

function parsePullRequest(value: unknown): Omit<PublishedPullRequest, 'branchName' | 'commitSha' | 'reused'> {
  if (!isRecord(value) || typeof value.number !== 'number' || typeof value.html_url !== 'string') {
    throw new Error('GitHub pull-request response was invalid');
  }
  return { number: value.number, url: value.html_url };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
