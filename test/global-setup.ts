import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { getTestDatabaseUrl } from './test-database-url.js';

export default async function globalSetup() {
  const pool = new Pool({ connectionString: getTestDatabaseUrl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
