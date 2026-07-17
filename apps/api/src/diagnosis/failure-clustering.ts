import { createHash } from 'node:crypto';

export type ExtractedFailureCluster = {
  fingerprint: string;
  testName: string;
  errorExcerpt: string;
  logArtifactSha256: string;
};

export function extractFailureClusters(log: string, logArtifactSha256: string): ExtractedFailureCluster[] {
  const clusters: ExtractedFailureCluster[] = [];
  const pattern = /# Subtest:\s*([^\r\n]+)\r?\nnot ok \d+ - [^\r\n]+\r?\n([\s\S]*?)(?=\r?\n# Subtest:|\r?\n1\.\.\d+|\r?\n# tests|$)/g;

  for (const match of log.matchAll(pattern)) {
    const testName = match[1]?.trim();
    const details = normalizeExcerpt(match[2] ?? '');
    if (!testName || !details) {
      continue;
    }
    clusters.push({
      fingerprint: fingerprint(testName, details),
      testName,
      errorExcerpt: details,
      logArtifactSha256
    });
  }

  if (clusters.length > 0) {
    return clusters;
  }

  const fallback = normalizeExcerpt(log);
  return fallback
    ? [{
        fingerprint: fingerprint('unattributed CI failure', fallback),
        testName: 'unattributed CI failure',
        errorExcerpt: fallback,
        logArtifactSha256
      }]
    : [];
}

function normalizeExcerpt(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:)?[\\/][^\r\n'\")]+/g, (absolutePath: string) => {
      const normalized = absolutePath.replaceAll('\\', '/');
      const testLocation = /test\/[A-Za-z0-9._-]+\.test\.[A-Za-z0-9]+(?::\d+:\d+)?/i.exec(normalized);
      return testLocation?.[0] ?? '<workspace-path>';
    })
    .replace(/(?<!test)\/[^\s)]+/g, '<workspace-path>')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 3_800);
}

function fingerprint(testName: string, excerpt: string): string {
  return createHash('sha256')
    .update(`${testName}\n${excerpt.replace(/\d+(?:\.\d+)?/g, '#')}`)
    .digest('hex');
}
