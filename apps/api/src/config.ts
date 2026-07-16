import { z } from 'zod';
import { resolveSecrets } from './security/secret-resolver.js';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BIND_HOST: z.string().ip().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4300),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  GITHUB_WEBHOOK_SECRET: z.string().min(32),
  GITHUB_ALLOWED_REPOSITORIES: z.string().min(3),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(64),
  ARTIFACT_ENCRYPTION_KEY_BASE64: z.string().min(40),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info')
});

export type AppConfig = {
  environment: 'development' | 'test' | 'production';
  bindHost: string;
  port: number;
  databaseUrl: string;
  githubWebhookSecret: string;
  allowedRepositories: ReadonlySet<string>;
  githubAppId: number;
  githubAppPrivateKey: string;
  artifactEncryptionKey: Buffer;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug';
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(resolveSecrets(environment));
  const allowedRepositories = new Set(
    parsed.GITHUB_ALLOWED_REPOSITORIES.split(',').map((repository) => repository.trim()).filter(Boolean)
  );

  if (allowedRepositories.size === 0) {
    throw new Error('GITHUB_ALLOWED_REPOSITORIES must contain at least one repository');
  }

  if (parsed.NODE_ENV === 'production' && parsed.BIND_HOST === '0.0.0.0') {
    throw new Error('Production API must bind behind an authenticated ingress, not directly to 0.0.0.0');
  }

  const artifactEncryptionKey = Buffer.from(parsed.ARTIFACT_ENCRYPTION_KEY_BASE64, 'base64');
  if (artifactEncryptionKey.length !== 32) {
    throw new Error('ARTIFACT_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes');
  }

  return {
    environment: parsed.NODE_ENV,
    bindHost: parsed.BIND_HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
    allowedRepositories,
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    artifactEncryptionKey,
    logLevel: parsed.LOG_LEVEL
  };
}
