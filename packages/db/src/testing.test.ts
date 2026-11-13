import { describe, expect, it } from 'vitest';
import {
  assertConnectedToTestDatabase,
  resolveIntegrationTestTargets,
  UnsafeTestEnvironmentError,
} from './testing.js';

const dev = {
  DATABASE_URL: 'postgresql://app_user:a@localhost:5432/dokanflow',
  MIGRATION_DATABASE_URL: 'postgresql://dokanflow:o@localhost:5432/dokanflow',
  REDIS_URL: 'redis://localhost:6379',
};
const test = {
  TEST_DATABASE_URL: 'postgresql://app_user:a@localhost:5432/dokanflow_test',
  TEST_MIGRATION_DATABASE_URL: 'postgresql://dokanflow:o@localhost:5432/dokanflow_test',
  TEST_REDIS_URL: 'redis://localhost:6379/1',
};

describe('resolveIntegrationTestTargets', () => {
  it('accepts a separate *_test database and Redis index', () => {
    expect(resolveIntegrationTestTargets({ ...dev, ...test })).toEqual({
      databaseUrl: test.TEST_DATABASE_URL,
      migrationDatabaseUrl: test.TEST_MIGRATION_DATABASE_URL,
      redisUrl: test.TEST_REDIS_URL,
    });
  });

  it('works in CI where no development variables exist', () => {
    expect(() => resolveIntegrationTestTargets(test)).not.toThrow();
  });

  it.each([['TEST_DATABASE_URL'], ['TEST_MIGRATION_DATABASE_URL'], ['TEST_REDIS_URL']] as const)(
    'never falls back to development settings when %s is missing',
    (name) => {
      expect(() => resolveIntegrationTestTargets({ ...dev, ...test, [name]: undefined })).toThrow(
        UnsafeTestEnvironmentError,
      );
    },
  );

  it('refuses a database whose name does not end in _test', () => {
    expect(() =>
      resolveIntegrationTestTargets({
        ...test,
        TEST_DATABASE_URL: dev.DATABASE_URL,
        TEST_MIGRATION_DATABASE_URL: dev.MIGRATION_DATABASE_URL,
      }),
    ).toThrow(/does not end in "_test"/);
  });

  it('refuses when the test database is the development database', () => {
    expect(() =>
      resolveIntegrationTestTargets({
        ...test,
        DATABASE_URL: 'postgresql://someone:x@LOCALHOST/dokanflow_test',
      }),
    ).toThrow(/same as DATABASE_URL/);
  });

  it('refuses app and owner URLs that point at different databases', () => {
    expect(() =>
      resolveIntegrationTestTargets({
        ...test,
        TEST_MIGRATION_DATABASE_URL: 'postgresql://dokanflow:o@localhost:5432/other_test',
      }),
    ).toThrow(/different databases/);
  });

  it('refuses the development Redis database, including the implicit index 0', () => {
    expect(() =>
      resolveIntegrationTestTargets({
        ...dev,
        ...test,
        TEST_REDIS_URL: 'redis://localhost:6379/0',
      }),
    ).toThrow(/same Redis database/);
  });

  it('refuses non-Postgres and non-Redis URLs', () => {
    expect(() =>
      resolveIntegrationTestTargets({ ...test, TEST_DATABASE_URL: 'mysql://x@h/db_test' }),
    ).toThrow(/postgresql:\/\//);
    expect(() =>
      resolveIntegrationTestTargets({ ...test, TEST_REDIS_URL: 'http://localhost' }),
    ).toThrow(/redis:\/\//);
  });
});

describe('assertConnectedToTestDatabase', () => {
  const client = (db: string) => ({
    $queryRaw: <T>() => Promise.resolve([{ db }] as T),
  });

  it('accepts a connection to a *_test database', async () => {
    await expect(assertConnectedToTestDatabase(client('dokanflow_test'))).resolves.toBeUndefined();
  });

  it('rejects a connection to any other database', async () => {
    await expect(assertConnectedToTestDatabase(client('dokanflow'))).rejects.toThrow(
      UnsafeTestEnvironmentError,
    );
  });
});
