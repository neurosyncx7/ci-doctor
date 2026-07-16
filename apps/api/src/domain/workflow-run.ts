import { z } from 'zod';

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i).transform((value) => value.toLowerCase());

const workflowRunEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string().min(3).max(200)
  }),
  workflow_run: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive().default(1),
    name: z.string().min(1).max(200),
    conclusion: z.string().nullable(),
    head_sha: shaSchema,
    head_branch: z.string().min(1).max(255),
    pull_requests: z.array(z.object({ base: z.object({ sha: shaSchema }).optional() })).default([])
  })
});

export type FailedWorkflowRun = {
  githubRepoId: number;
  githubInstallationId: number;
  repoFullName: string;
  workflowRunId: number;
  runAttempt: number;
  workflowName: string;
  headSha: string;
  baseSha: string | null;
  headBranch: string;
};

export function parseFailedWorkflowRun(payload: unknown): FailedWorkflowRun | null {
  const event = workflowRunEventSchema.parse(payload);
  if (event.action !== 'completed' || event.workflow_run.conclusion !== 'failure') {
    return null;
  }

  return {
    githubRepoId: event.repository.id,
    githubInstallationId: event.installation.id,
    repoFullName: event.repository.full_name,
    workflowRunId: event.workflow_run.id,
    runAttempt: event.workflow_run.run_attempt,
    workflowName: event.workflow_run.name,
    headSha: event.workflow_run.head_sha,
    baseSha: event.workflow_run.pull_requests[0]?.base?.sha ?? null,
    headBranch: event.workflow_run.head_branch
  };
}
