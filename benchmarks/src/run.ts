import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { classifyFailure, type FailureTaxonomy } from './taxonomy.js';

const caseSchema = z.object({ id:z.string(), tier:z.number().int().min(1).max(5), domain:z.string(), repo:z.string(), buggyRef:z.string(), testCommand:z.string(), prompt:z.string(), hints:z.array(z.string()) });
const manifestSchema = z.object({ schemaVersion:z.literal(1), cases:z.array(caseSchema) });
type BenchmarkCase = z.infer<typeof caseSchema>;
type RunRecord = { runId:string; caseId:string; tier:number; hintLevel:number; ablation:'agents'|'no-agents'; status:'passed'|'failed'|'blocked'; durationMs:number; testExitCode:number|null; taxonomy:FailureTaxonomy|null; worktree:string; diffPath:string; visibleTracePath:string; metadataPath:string };
const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'artifacts');

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const hintLevel = Number(process.env.BENCHMARK_HINT_LEVEL ?? (args.has('--hint') ? 1 : 0));
  const ablation = args.has('--without-agents') ? 'no-agents' : 'agents';
  const selected = process.env.BENCHMARK_CASE;
  const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(root, 'ladder.json'), 'utf8')));
  const cases = manifest.cases.filter((item) => !selected || item.id === selected);
  if (cases.length === 0) throw new Error('No benchmark cases matched BENCHMARK_CASE');
  await mkdir(outputRoot, { recursive:true });
  for (const item of cases) await runCase(item, hintLevel, ablation);
}

async function runCase(item: BenchmarkCase, hintLevel: number, ablation: 'agents'|'no-agents'): Promise<void> {
  if (item.buggyRef === 'BUGGY_REF_REQUIRED') throw new Error(`Case ${item.id} is catalogued but not seeded. Pin its buggy commit before running it.`);
  const runId = `${item.id}-${randomUUID()}`; const runDir = resolve(outputRoot, runId); const worktree = resolve(runDir, 'worktree'); await mkdir(runDir, { recursive:true });
  const repository = resolve(process.cwd(), item.repo); const prompt = [item.prompt, hintLevel > 0 ? `Hint ${hintLevel}: ${item.hints[Math.min(hintLevel - 1, item.hints.length - 1)]}` : '', 'Do not change CI, dependencies, package configuration, or benchmark harness files. Run the required test command before concluding.'].filter(Boolean).join('\n\n');
  const started = Date.now();
  await command('git', ['worktree','add','--detach',worktree,item.buggyRef], repository);
  try {
    const codex = process.env.CODEX_BIN ?? 'codex';
    const visible = await command(codex, ['exec','--ephemeral','--ignore-user-config','-s','workspace-write','-C',worktree,'-'], undefined, prompt);
    const diff = await command('git',['diff','--no-ext-diff','--binary','HEAD'],worktree);
    const tests = process.platform === 'win32'
      ? await command('cmd.exe',['/d','/s','/c',item.testCommand],worktree,undefined,true)
      : await command('sh',['-lc',item.testCommand],worktree,undefined,true);
    const status: RunRecord['status'] = tests.exitCode === 0 ? 'passed' : 'failed';
    const taxonomy = status === 'passed' ? null : classifyFailure({ visibleTrace:visible.stdout + visible.stderr, diff:diff.stdout, testExitCode:tests.exitCode });
    const record: RunRecord = { runId, caseId:item.id, tier:item.tier, hintLevel, ablation, status, durationMs:Date.now()-started, testExitCode:tests.exitCode, taxonomy, worktree, diffPath:resolve(runDir,'patch.diff'), visibleTracePath:resolve(runDir,'visible-trace.log'), metadataPath:resolve(runDir,'run.json') };
    await writeFile(record.diffPath,diff.stdout); await writeFile(record.visibleTracePath,visible.stdout + visible.stderr); await writeFile(record.metadataPath,JSON.stringify(record,null,2));
    process.stdout.write(`${item.id}: ${status}${taxonomy ? ` (${taxonomy})` : ''}\n`);
  } finally { await command('git',['worktree','remove','--force',worktree],repository); }
}

function command(bin:string,args:string[],cwd?:string,stdin?:string,allowFailure=false):Promise<{stdout:string;stderr:string;exitCode:number}> { return new Promise((resolvePromise,reject)=>{ const child=spawn(bin,args,{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']}); let stdout='',stderr=''; child.stdout.on('data',(d:Buffer)=>stdout+=d);child.stderr.on('data',(d:Buffer)=>stderr+=d);child.stdin.end(stdin);child.on('error',reject);child.on('close',(code)=>{const result={stdout,stderr,exitCode:code??1};if(result.exitCode!==0&&!allowFailure) reject(new Error(`${basename(bin)} failed: ${stderr.slice(0,500)}`));else resolvePromise(result);});}); }
void main();
