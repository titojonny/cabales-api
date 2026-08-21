import { Prisma } from '@prisma/client';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDatabase } from './database/client.js';
import { createApp } from './http/app.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { EventsRepository } from './modules/events/events.repository.js';
import { EventsService } from './modules/events/events.service.js';
import { ExpensesRepository } from './modules/expenses/expenses.repository.js';
import { ExpensesService } from './modules/expenses/expenses.service.js';
import { GroupsRepository } from './modules/groups/groups.repository.js';
import { GroupsService } from './modules/groups/groups.service.js';
import { SettlementsRepository } from './modules/settlements/settlements.repository.js';
import { SettlementsService } from './modules/settlements/settlements.service.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDatabase(config.DATABASE_URL);
const groups = new GroupsService(new GroupsRepository(db));
const auth = new AuthService(new AuthRepository(db), config.sessionTtlMs);
const events = new EventsService(new EventsRepository(db), groups);
const expenses = new ExpensesService(new ExpensesRepository(db), groups);
const settlements = new SettlementsService(new SettlementsRepository(db), groups);

const app = createApp({
  config,
  logger,
  auth,
  groups,
  events,
  expenses,
  settlements,
  readiness: async () => {
    try {
      await db.$queryRaw(Prisma.sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  },
});

const server = app.listen(config.PORT, () =>
  logger.info({ port: config.PORT }, 'Cabales API iniciada'),
);

/** Cierra listener y pool sin aceptar trabajo nuevo. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Cierre controlado');
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
