import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/** Configura schema, seed y URL externa para Prisma 7 sin migraciones. */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/invalid',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
