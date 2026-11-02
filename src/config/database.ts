import knex, { Knex } from 'knex';
import { env } from './env';

if (!env.databaseUrl) {
  throw new Error('DATABASE_URL is required. See .env.example.');
}

/**
 * Shared Knex instance. All money movement must go through
 * `db.transaction()` so that the escrow state update and its audit row commit
 * atomically.
 */
export const db: Knex = knex({
  client: 'pg',
  connection: env.databaseUrl,
  pool: { min: 0, max: 10 },
  acquireConnectionTimeout: 10_000,
});

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
