import { createAppAuth } from '@octokit/auth-app';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { repairPolicySchema, type RepairPolicy } from './policy.js';
import type { ValidatedFileChange } from '../github/pr-broker.js';

const checkedInPolicySchema = z.object({ schemaVersion: z.literal(1), runtime: z.literal('node22') }).passthrough();

export type CheckedOutRepository = {
  path: string;
  policy: RepairPolicy;
  packageScripts: Readonly<Record<string, string>>;
  context: string;
  changesFromDiff(diff: string): Promise<readonly ValidatedFileChange[]>;
  destroy(): Promise<void>;
};

/**
 * Downloads untrusted source only. It never executes repository commands on the host;
 * test execution happens later in the DockerRepairSandbox. The installation token is
 * passed to git through one process-local header and is not written to git config.
 */
export class GitHubSourceCheckout {
  private readonly authenticate;

  constructor(appId: number, privateKey: string, private readonly root = resolve(process.cwd(), '.repair-runs')) {
    this.authenticate = createAppAuth({ appId, privateKey });
  }

  async checkout(input: { installationId: number; repository: string; sourceSha: string }): Promise<CheckedOutRepository> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository) || !/^[0-9a-f]{40}$/i.test(input.sourceSha)) {
      throw new Error('Repository checkout input is invalid');
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, `${basename(input.repository)}-${randomUUID()}`);
    const auth = await this.authenticate({ type: 'installation', installationId: input.installationId });
    const header = Buffer.from(`x-access-token:${auth.token}`, 'utf8').toString('base64');
    try {
      await runGit(['clone', '--no-checkout', '--no-tags', '--filter=blob:none', `https://github.com/${input.repository}.git`, path], undefined, {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${header}`
      });
      await runGit(['-c', 'core.autocrlf=false', 'checkout', '--detach', '--force', input.sourceSha], path);
      const policyText = await showFile(path, 'ci-doctor.policy.json');
      const checkedIn = checkedInPolicySchema.parse(JSON.parse(policyText));
      const { schemaVersion: _schemaVersion, runtime: _runtime, ...policyCandidate } = checkedIn;
      const policy = repairPolicySchema.parse(policyCandidate);
      const packageJson = JSON.parse(await showFile(path, 'package.json')) as { scripts?: unknown };
      const packageScripts = parseScripts(packageJson.scripts);
      const context = await buildSafeContext(path);
      return {
        path,
        policy,
        packageScripts,
        context,
        changesFromDiff: (diff) => readValidatedChanges(path, diff),
        destroy: async () => { await rm(path, { recursive: true, force: true, maxRetries: 2 }); }
      };
    } catch (error) {
      await rm(path, { recursive: true, force: true, maxRetries: 2 });
      throw error;
    }
  }
}

async function buildSafeContext(workspace: string): Promise<string> {
  const listed = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], workspace);
  const paths = listed.stdout.split(/\r?\n/).filter(isContextPath).slice(0, 80);
  const sections: string[] = [];
  let budget = 60_000;
  for (const path of paths) {
    if (budget <= 0) break;
    const content = await showFile(workspace, path);
    const clipped = content.slice(0, Math.min(8_000, budget));
    sections.push(`--- ${path} ---\n${clipped}`);
    budget -= clipped.length;
  }
  if (sections.length === 0) throw new Error('Repository has no permitted source context');
  return sections.join('\n\n');
}

function isContextPath(path: string): boolean {
  if (path === 'package.json') return true;
  if (/^(src|test|tests|lib|app)\//.test(path) && !/(^|\/)\.env(?:\.|$)/.test(path)) return true;
  return false;
}

function parseScripts(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(value)) {
    if (typeof command === 'string' && command.length <= 2_000) scripts[name] = command;
  }
  return scripts;
}

async function readValidatedChanges(workspace: string, diff: string): Promise<readonly ValidatedFileChange[]> {
  if (/^deleted file mode /m.test(diff) || /^\+\+\+ \/dev\/null$/m.test(diff)) {
    throw new Error('Autonomous repairs may not delete files');
  }
  const paths = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]!);
  if (paths.length === 0 || new Set(paths).size !== paths.length) throw new Error('Repair diff did not have unique file paths');
  const root = await realpath(workspace);
  const changes: ValidatedFileChange[] = [];
  for (const path of paths) {
    if (path.includes('..') || path.startsWith('/') || !/^[A-Za-z0-9._/-]+$/.test(path)) throw new Error('Repair diff contained an invalid path');
    const absolute = resolve(workspace, path);
    const resolved = await realpath(absolute);
    if (relative(root, resolved).startsWith('..')) throw new Error('Repair diff resolved outside its workspace');
    const metadata = await lstat(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Repair diff may only publish regular files');
    changes.push({ path, content: await readFile(resolved) });
  }
  return changes;
}

async function showFile(workspace: string, path: string): Promise<string> {
  const result = await runGit(['show', `HEAD:${path}`], workspace);
  return result.stdout;
}

function runGit(args: readonly string[], cwd?: string, environment: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnvironment(environment)
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error('Git source checkout operation failed'));
    });
  });
}

function gitEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = process.env;
  return {
    PATH: inherited.PATH,
    SystemRoot: inherited.SystemRoot,
    COMSPEC: inherited.COMSPEC,
    TEMP: inherited.TEMP,
    TMP: inherited.TMP,
    USERPROFILE: inherited.USERPROFILE,
    HOME: inherited.HOME,
    ...overrides
  };
}
