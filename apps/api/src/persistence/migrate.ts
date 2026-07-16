import { resolveSecrets } from '../security/secret-resolver.js';
import { runMigrations } from './migration-runner.js';

async function main(): Promise<void> {
  const environment = resolveSecrets(process.env);
  if (!environment.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  await runMigrations(environment.DATABASE_URL, 'infra/postgres/migrations');
}

void main();
