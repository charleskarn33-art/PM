import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (migrations, generate, seed). The connection string
// comes from the environment (.env locally, never committed). `prisma generate`
// needs no database, so DATABASE_URL may be absent there; migrate commands
// fail if it is missing.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
