import { Pool, type PoolClient } from 'pg';

export type Database = {
  pool: Pool;
  transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'ci-doctor-api'
  });

  return {
    pool,
    async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '5s'");
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    }
  };
}
