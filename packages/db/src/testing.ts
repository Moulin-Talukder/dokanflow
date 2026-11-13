/**
 * Guards for integration tests. Tests read only TEST_* variables and refuse to run
 * unless they clearly point at a disposable test database (name ends in "_test")
 * that is not the development database. Imported via "@dokanflow/db/testing".
 */

export class UnsafeTestEnvironmentError extends Error {
  constructor(problem: string) {
    super(
      `Refusing to run integration tests: ${problem}. ` +
        'Set TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL and TEST_REDIS_URL ' +
        '(see .env.example and docs/DEVELOPMENT.md).',
    );
    this.name = 'UnsafeTestEnvironmentError';
  }
}

export interface IntegrationTestTargets {
  /** Runtime role (app_user) connection to the test database. */
  databaseUrl: string;
  /** Schema-owner connection to the same test database (migrations, fixtures). */
  migrationDatabaseUrl: string;
  /** Redis for tests: a separate logical database from development. */
  redisUrl: string;
}

const TEST_DB_SUFFIX = '_test';

interface PostgresTarget {
  host: string;
  port: string;
  database: string;
}

function parsePostgres(name: string, value: string | undefined): PostgresTarget {
  if (!value) {
    throw new UnsafeTestEnvironmentError(`${name} is not set`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeTestEnvironmentError(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new UnsafeTestEnvironmentError(`${name} must be a postgresql:// URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database.endsWith(TEST_DB_SUFFIX)) {
    throw new UnsafeTestEnvironmentError(
      `${name} points at database "${database}", whose name does not end in "${TEST_DB_SUFFIX}"`,
    );
  }
  return { host: url.hostname.toLowerCase(), port: url.port || '5432', database };
}

/** Optional comparison target; malformed development URLs are simply not compared. */
function tryParsePostgres(value: string | undefined): PostgresTarget | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}

function samePostgres(a: PostgresTarget, b: PostgresTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

interface RedisTarget {
  host: string;
  port: string;
  db: string;
}

function parseRedis(value: string): RedisTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return null;
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || '6379',
      db: url.pathname.replace(/^\//, '') || '0',
    };
  } catch {
    return null;
  }
}

/**
 * Resolves and validates the integration-test targets. Throws
 * UnsafeTestEnvironmentError when anything could touch development data:
 * missing TEST_* variables, a database name without "_test", the app and owner
 * URLs pointing at different databases, or a target equal to the development one.
 */
export function resolveIntegrationTestTargets(env: NodeJS.ProcessEnv): IntegrationTestTargets {
  const app = parsePostgres('TEST_DATABASE_URL', env.TEST_DATABASE_URL);
  const owner = parsePostgres('TEST_MIGRATION_DATABASE_URL', env.TEST_MIGRATION_DATABASE_URL);
  if (!samePostgres(app, owner)) {
    throw new UnsafeTestEnvironmentError(
      'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL point at different databases',
    );
  }
  for (const devName of ['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const) {
    const dev = tryParsePostgres(env[devName]);
    if (dev && samePostgres(app, dev)) {
      throw new UnsafeTestEnvironmentError(`the test database is the same as ${devName}`);
    }
  }

  const redisUrl = env.TEST_REDIS_URL;
  if (!redisUrl) {
    throw new UnsafeTestEnvironmentError('TEST_REDIS_URL is not set');
  }
  const testRedis = parseRedis(redisUrl);
  if (!testRedis) {
    throw new UnsafeTestEnvironmentError('TEST_REDIS_URL must be a redis:// or rediss:// URL');
  }
  const devRedis = env.REDIS_URL ? parseRedis(env.REDIS_URL) : null;
  if (
    devRedis?.host === testRedis.host &&
    devRedis.port === testRedis.port &&
    devRedis.db === testRedis.db
  ) {
    throw new UnsafeTestEnvironmentError(
      'TEST_REDIS_URL is the same Redis database as REDIS_URL (use another index, e.g. /1)',
    );
  }

  return {
    databaseUrl: env.TEST_DATABASE_URL ?? '',
    migrationDatabaseUrl: env.TEST_MIGRATION_DATABASE_URL ?? '',
    redisUrl,
  };
}

/** Anything that can run a raw query, e.g. a PrismaClient. */
interface RawQueryable {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Second line of defence after connecting: asks the server which database it is,
 * so a URL that resolves somewhere unexpected (DNS, pgbouncer alias) is still caught.
 */
export async function assertConnectedToTestDatabase(client: RawQueryable): Promise<void> {
  const rows = await client.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const name = rows[0]?.db ?? '';
  if (!name.endsWith(TEST_DB_SUFFIX)) {
    throw new UnsafeTestEnvironmentError(
      `connected to database "${name}", which is not a test database`,
    );
  }
}
