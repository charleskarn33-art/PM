import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The test helpers delete data; they only ever run against a database named *_test. */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example): integration tests need a MySQL test database.');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) throw new Error(`Refusing to run integration tests against "${name}": the test database name must end in "_test".`);
  return url;
}

/**
 * Brings the test database up to date with `prisma migrate deploy` (applies
 * pending migrations; never drops anything), so the tests exercise the real
 * migrations, triggers and CHECK constraints.
 */
export default function setup() {
  const url = assertTestDatabase(process.env.TEST_DATABASE_URL);
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
