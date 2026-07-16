import { resolveSecrets } from '../security/secret-resolver.js';
import { runMigrations } from './migration-runner.js';

async function main(): Promise<void> {
  const environment = resolveSecrets(process.env);
  const migrationDatabaseUrl = environment.MIGRATION_DATABASE_URL ?? environment.DATABASE_URL;
  if (!migrationDatabaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL is required to run migrations');
  }
  await runMigrations(migrationDatabaseUrl, 'infra/postgres/migrations');
}

void main();
