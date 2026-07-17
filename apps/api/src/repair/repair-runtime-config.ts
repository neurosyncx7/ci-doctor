import { z } from 'zod';

const schema = z.object({
  CI_DOCTOR_MODEL_PROVIDER: z.enum(['openai', 'codex_cli']).default('openai'),
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_REPAIR_MODEL: z.string().min(3).max(100).default('gpt-5.6-terra')
});

export type RepairRuntimeConfig = {
  provider: 'openai' | 'codex_cli';
  apiKey: string | undefined;
  model: string;
};

export function loadRepairRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RepairRuntimeConfig {
  const parsed = schema.parse(environment);
  if (parsed.CI_DOCTOR_MODEL_PROVIDER === 'openai' && !parsed.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when CI_DOCTOR_MODEL_PROVIDER=openai');
  }
  return { provider: parsed.CI_DOCTOR_MODEL_PROVIDER, apiKey: parsed.OPENAI_API_KEY, model: parsed.OPENAI_REPAIR_MODEL };
}