import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPullRequestBroker } from '../src/github/pr-broker.js';

const sha = (digit: string) => digit.repeat(40);

test('publishes validated content through Git objects without giving the sandbox a GitHub token', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const broker = new GitHubPullRequestBroker(
    1,
    'unused-in-test',
    async (url, init) => {
      calls.push({ url, method: init.method ?? 'GET' });
      const path = new URL(url).pathname;
      const payload = path.endsWith('/pulls') && init.method === 'POST'
        ? { number: 42, html_url: 'https://github.com/acme/fixture/pull/42' }
        : path.includes('/pulls')
          ? []
          : path.includes('/git/commits/') && init.method !== 'POST'
            ? { tree: { sha: sha('b') } }
            : path.endsWith('/git/blobs')
              ? { sha: sha('c') }
              : path.endsWith('/git/trees')
                ? { sha: sha('d') }
                : path.endsWith('/git/commits')
                  ? { sha: sha('e') }
                  : {};
      return { ok: true, status: 200, json: async () => payload, text: async () => '' };
    },
    async () => ({ authorization: 'Bearer test' })
  );

  const result = await broker.publish({
    installationId: 7,
    repoFullName: 'acme/fixture',
    baseSha: sha('a'),
    baseBranch: 'main',
    branchName: 'ci-doctor/incident-1',
    title: 'CI Doctor: correct pagination',
    body: 'Validated in a sandbox.',
    commitMessage: 'fix: correct pagination',
    changes: [{ path: 'src/pagination.js', content: Buffer.from('module.exports = {};\n') }]
  });

  assert.deepEqual(result, {
    number: 42,
    url: 'https://github.com/acme/fixture/pull/42',
    branchName: 'ci-doctor/incident-1',
    commitSha: sha('e'),
    reused: false
  });
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST', 'POST', 'POST', 'POST', 'POST']);
});

test('reuses an existing branch PR before creating any Git write', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const broker = new GitHubPullRequestBroker(
    1,
    'unused-in-test',
    async (url, init) => {
      calls.push({ url, method: init.method ?? 'GET' });
      return {
        ok: true,
        status: 200,
        json: async () => [{ number: 9, html_url: 'https://github.com/acme/fixture/pull/9' }],
        text: async () => ''
      };
    },
    async () => ({ authorization: 'Bearer test' })
  );
  const result = await broker.publish({
    installationId: 7,
    repoFullName: 'acme/fixture',
    baseSha: sha('a'),
    baseBranch: 'main',
    branchName: 'ci-doctor/incident-1',
    title: 'ignored',
    body: 'ignored',
    commitMessage: 'ignored',
    changes: [{ path: 'src/pagination.js', content: Buffer.from('x') }]
  });
  assert.equal(result.reused, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'GET');
});
