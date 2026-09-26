/**
 * Creates the first Super Admin of a new installation:
 *
 *   pnpm db:create-admin --email admin@example.com --name "Jane Doe"
 *
 * The password is typed at a hidden prompt (or, for unattended setups, read
 * from the ADMIN_INITIAL_PASSWORD environment variable). It is never taken
 * from the command line, where it would be kept in shell history.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../apps/api/src/prisma/create-client.js';
import { createFirstAdmin } from '../apps/api/src/seed/first-admin.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (!values.email || !values.name) {
  console.error('Usage: pnpm db:create-admin --email <address> --name "<full name>"');
  process.exit(2);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No terminal for the password prompt: set ADMIN_INITIAL_PASSWORD instead.'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdout.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
let password = process.env.ADMIN_INITIAL_PASSWORD ?? '';
if (!password) {
  password = await promptHidden('Password (12–128 characters): ');
  if (password !== (await promptHidden('Repeat the password: '))) {
    console.error('The passwords do not match.');
    process.exit(1);
  }
}

const prisma = createPrismaClient(url);
try {
  const admin = await createFirstAdmin(prisma, { email: values.email, fullName: values.name, password });
  console.log(`Super Admin created: ${admin.email}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
