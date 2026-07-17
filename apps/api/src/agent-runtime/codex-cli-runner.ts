import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type JsonSchema = Record<string, unknown>;

export class CodexCliRunner {
  constructor(
    private readonly model: string,
    private readonly timeoutMs = 120_000
  ) {
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(model)) {
      throw new Error('Codex CLI model identifier is invalid');
    }
  }

  async runJson<T>(input: { prompt: string; schema: JsonSchema }): Promise<{ value: T; invocationId: string }> {
    const invocationId = randomUUID();
    const root = await mkdtemp(join(tmpdir(), 'ci-doctor-codex-'));
    const schemaPath = join(root, 'output-schema.json');
    const outputPath = join(root, 'output.json');
    try {
      await writeFile(schemaPath, JSON.stringify(input.schema), { encoding: 'utf8', mode: 0o600 });
      await this.execute(root, schemaPath, outputPath, input.prompt);
      const output = await readFile(outputPath, 'utf8');
      if (Buffer.byteLength(output, 'utf8') > 200_000) {
        throw new Error('Codex CLI output exceeded the safety limit');
      }
      return { value: JSON.parse(output) as T, invocationId };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Codex CLI returned invalid structured output');
      }
      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async execute(root: string, schemaPath: string, outputPath: string, prompt: string): Promise<void> {
    const codexEntrypoint = process.env.CODEX_CLI_ENTRYPOINT ?? join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const codexArgs = [
      codexEntrypoint,
      'exec',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '--model', this.model,
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-C', root,
      '-'
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, codexArgs, {
        cwd: root,
        env: trustedCodexEnvironment(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let timedOut = false;
      let stderrSize = 0;
      const timeout = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          void spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        }
      }, this.timeoutMs);
      child.stderr.on('data', (chunk: Buffer) => { stderrSize += chunk.length; });
      child.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('Codex CLI could not be started'));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (timedOut) return reject(new Error('Codex CLI exceeded its execution budget'));
        if (code !== 0) return reject(new Error(`Codex CLI exited with code ${code ?? 'unknown'} (stderr bytes: ${stderrSize})`));
        resolve();
      });
      child.stdin.end(prompt, 'utf8');
    });
  }
}

function trustedCodexEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'APPDATA', 'CODEX_HOME', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'
  ];
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
}
