import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
type Run = { caseId:string; tier:number; hintLevel:number; ablation:string; status:string; taxonomy:string|null; durationMs:number };
async function main(): Promise<void> {
  const root=resolve(import.meta.dirname,'..'); const artifacts=resolve(root,'artifacts'); await mkdir(artifacts,{recursive:true});
  const runs:Run[]=[]; for(const entry of await readdir(artifacts,{withFileTypes:true})){if(!entry.isDirectory())continue;try{runs.push(JSON.parse(await readFile(resolve(artifacts,entry.name,'run.json'),'utf8')));}catch{}}
  const byTier=Object.groupBy(runs,(run)=>`Tier ${run.tier}`); const rows=Object.entries(byTier).map(([tier,items])=>{const list=items??[];const pass=list.filter((r)=>r.status==='passed').length;return `| ${tier} | ${list.length} | ${pass} | ${list.length?Math.round(pass/list.length*100):0}% |`;});
  const taxonomy=Object.groupBy(runs.filter((r)=>r.taxonomy),(r)=>r.taxonomy!); const failureRows=Object.entries(taxonomy).map(([name,items])=>`| ${name} | ${items?.length??0} |`).join('\n');
  await writeFile(resolve(root,'BENCHMARK_REPORT.md'),`# CI Doctor benchmark report\n\nGenerated from reproducible run artifacts. Visible agent summaries and tool output are retained; hidden reasoning is never collected.\n\n| Tier | Runs | Passed | Solve rate |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## Failure taxonomy\n\n| Category | Count |\n| --- | ---: |\n${failureRows||'| none | 0 |'}\n\n## Hint-budget curve\n\nCompare runs by \`caseId\` and \`hintLevel\`; a pass at a higher level quantifies the minimum hint that unlocked the case.\n`);
}
void main();
