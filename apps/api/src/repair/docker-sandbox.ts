import { spawn } from 'node:child_process';
import { delimiter, dirname, resolve } from 'node:path';
import { assertAllowedCommand, assertPatchWithinPolicy, type RepairPolicy } from './policy.js';
import type { RepairSandbox, SandboxCommandResult } from './sandbox-contract.js';

export type DockerSandboxOptions = {
  workspacePath: string;
  image?: string;
  dockerBinary?: string;
  allowWorkspaceWrite?: boolean;
};

export class DockerRepairSandbox implements RepairSandbox {
  private readonly workspacePath: string;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly allowWorkspaceWrite: boolean;

  constructor(options: DockerSandboxOptions) {
    this.workspacePath = resolve(options.workspacePath);
    this.image = options.image ?? 'node:22-bookworm-slim';
    this.dockerBinary = options.dockerBinary ?? process.env.DOCKER_BIN ?? 'docker';
    this.allowWorkspaceWrite = options.allowWorkspaceWrite ?? false;
  }

  async applyPatch(patch: string, policy: RepairPolicy): Promise<void> {
    assertPatchWithinPolicy(patch, policy);
    if (!this.allowWorkspaceWrite) {
      throw new Error('This sandbox was created without a writable repair workspace');
    }
    const result = await runProcess(this.dockerBinary, [
      'run', '--rm', '--init', '-i', '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--mount', `type=bind,src=${this.workspacePath},dst=/workspace`,
      '--workdir', '/workspace', 'alpine/git:2.45.2', 'apply', '--whitespace=error', '--recount', '-'
    ], Math.min(policy.repairBudget.maxWallSeconds * 1000, 120_000), patch);
    if (result.exitCode !== 0) {
      throw new Error(`Sandbox rejected patch: ${result.stderr.slice(0, 500)}`);
    }
  }

  async execute(command: string, policy: RepairPolicy): Promise<SandboxCommandResult> {
    assertAllowedCommand(command, policy);
    const startedAt = Date.now();
    const containerCommand = command.replace(/^npm\.cmd(?=\s|$)/, 'npm');
    const result = await runProcess(this.dockerBinary, [
      'run', '--rm', '--init', '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '128', '--memory', '1024m', '--cpus', '1',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--mount', `type=bind,src=${this.workspacePath},dst=/workspace,readonly`,
      '--workdir', '/workspace', this.image, 'sh', '-lc', containerCommand
    ], policy.repairBudget.maxWallSeconds * 1000);
    return { command, durationMs: Date.now() - startedAt, ...result };
  }

  async readDiff(): Promise<string> {
    const result = await runProcess(this.dockerBinary, [
      'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m',
      '--mount', `type=bind,src=${this.workspacePath},dst=/workspace,readonly`,
      '--workdir', '/workspace', 'alpine/git:2.45.2', 'diff', '--no-ext-diff', '--binary', 'HEAD'
    ], 60_000);
    if (result.exitCode !== 0) {
      throw new Error('Sandbox could not read the workspace diff');
    }
    return result.stdout;
  }

  async destroy(): Promise<void> {
    // Each command uses --rm and a fresh container; no persistent sandbox survives a repair attempt.
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  stdin?: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const commandDirectory = dirname(command);
    const inheritedPath = process.env.PATH ?? '';
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${commandDirectory}${delimiter}${inheritedPath}` }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    if (stdin !== undefined) {
      child.stdin.end(stdin, 'utf8');
    } else {
      child.stdin.end();
    }
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: exitCode ?? 1, stdout: stdout.slice(0, 1_000_000), stderr: stderr.slice(0, 1_000_000) });
    });
  });
}
