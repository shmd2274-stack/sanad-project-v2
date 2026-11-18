import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
type Exec = (sql: string) => Promise<unknown>;
interface DbHandle { db: Db; exec: Exec; close: () => Promise<void>; kind: 'postgres' | 'pglite' }

// One connection per server process; survives Vite hot reloads in development.
const globalStore = globalThis as typeof globalThis & { __sanadDb?: Promise<DbHandle> | undefined };

async function connect(): Promise<DbHandle> {
  if (env.databaseUrl) {
    const [{ Pool }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')]);
    const pool = new Pool({ connectionString: env.databaseUrl, max: 10, ssl: /sslmode=require|supabase|neon\.tech/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined });
    return { db: drizzle({ client: pool, schema }), exec: sql => pool.query(sql), close: () => pool.end(), kind: 'postgres' };
  }
  const [{ PGlite }, { drizzle }] = await Promise.all([import('@electric-sql/pglite'), import('drizzle-orm/pglite')]);
  if (!env.pgliteDir.startsWith('memory://')) fs.mkdirSync(env.pgliteDir, { recursive: true });
  const client = await PGlite.create(env.pgliteDir);
  // The pglite and node-postgres drizzle databases share the same query API.
  return { db: drizzle({ client, schema }) as unknown as Db, exec: sql => client.exec(sql), close: () => client.close(), kind: 'pglite' };
}

async function migrate(handle: DbHandle) {
  await handle.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = await handle.db.execute(sql`SELECT id FROM schema_migrations`);
  const done = new Set((applied as unknown as { rows: { id: string }[] }).rows.map(row => row.id));
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await handle.exec(`BEGIN;\n${migration.sql}\nINSERT INTO schema_migrations (id) VALUES ('${migration.id.replace(/'/g, "''")}');\nCOMMIT;`).catch(async error => {
      await handle.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${migration.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function open(): Promise<DbHandle> {
  const handle = await connect();
  await migrate(handle);
  const { seedDatabase } = await import('./seed');
  await seedDatabase(handle.db);
  return handle;
}

export function getDbHandle(): Promise<DbHandle> {
  if (!globalStore.__sanadDb) {
    globalStore.__sanadDb = open().catch(error => { globalStore.__sanadDb = undefined; throw error; });
  }
  return globalStore.__sanadDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** Tests only: drop the cached connection so the next call opens a fresh database. */
export async function resetDbForTests() {
  const current = globalStore.__sanadDb;
  globalStore.__sanadDb = undefined;
  if (current) await (await current).close().catch(() => undefined);
}
