import { z } from 'zod';

const schema = z.object({
  OPENAI_API_KEY: z.string().min(20),
  OPENAI_DIAGNOSIS_MODEL: z.string().min(3).max(100).default('gpt-5.6'),
  DIAGNOSIS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(3)
});

export function loadDiagnosisRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  model: string;
  concurrency: number;
} {
  const parsed = schema.parse(environment);
  return {
    apiKey: parsed.OPENAI_API_KEY,
    model: parsed.OPENAI_DIAGNOSIS_MODEL,
    concurrency: parsed.DIAGNOSIS_WORKER_CONCURRENCY
  };
}
