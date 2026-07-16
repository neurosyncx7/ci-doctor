import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

export async function runMigrations(databaseUrl: string, migrationsDirectory: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, application_name: 'ci-doctor-migrator' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ci-doctor-schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .sort();
    for (const name of migrations) {
      const sql = await readFile(join(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (existing.rowCount === 1) {
        if (existing.rows[0]!.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${name}`);
        }
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
