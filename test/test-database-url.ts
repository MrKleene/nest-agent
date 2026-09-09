import { config } from 'dotenv';

export function getTestDatabaseUrl(): string {
  config({ quiet: true });

  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL must be explicitly configured for E2E tests',
    );
  }

  function databaseName(value: string, variable: string): string {
    try {
      const url = new URL(value);
      const name = decodeURIComponent(url.pathname.slice(1));
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !name ||
        name.includes('/')
      ) {
        throw new Error();
      }
      return name;
    } catch {
      throw new Error(`${variable} must be a valid PostgreSQL database URL`);
    }
  }

  const testDatabaseName = databaseName(testDatabaseUrl, 'TEST_DATABASE_URL');
  if (!testDatabaseName.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_URL must point to a database ending in _test',
    );
  }

  const applicationDatabaseUrl = process.env.DATABASE_URL;
  if (
    applicationDatabaseUrl &&
    databaseName(applicationDatabaseUrl, 'DATABASE_URL') === testDatabaseName
  ) {
    throw new Error(
      'TEST_DATABASE_URL must use a different database from DATABASE_URL',
    );
  }

  return testDatabaseUrl;
}
