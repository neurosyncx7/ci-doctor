import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './persistence/database.js';
import { PostgresIncidentStore } from './persistence/incident-store.js';
import { PostgresDashboardIncidentReadStore } from './dashboard/incident-read-store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const app = await buildApp({
    config,
    incidentStore: new PostgresIncidentStore(database),
    dashboardStore: new PostgresDashboardIncidentReadStore(database)
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down CI Doctor API');
    await app.close();
    await database.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.bindHost, port: config.port });
  } catch (error) {
    app.log.error(error, 'CI Doctor API failed to start');
    await database.close();
    process.exit(1);
  }
}

void main();
