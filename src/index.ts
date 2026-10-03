import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createContainer } from './composition.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
config.warnings.forEach((warning) => logger.warn({ config: true }, warning));
const { app, db, background, scheduler, rateLimitStores, storage, email, ocrProvider } =
  createContainer(config, logger);

scheduler.start();

const server = app.listen(config.PORT, () =>
  logger.info(
    {
      port: config.PORT,
      email: email.name,
      ocr: ocrProvider.name,
      storage: storage.name,
      rateLimitStore: rateLimitStores.kind,
    },
    'Cabales API iniciada',
  ),
);

/** Cierra listener, termina tareas en curso y libera conexiones sin aceptar trabajo nuevo. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Cierre controlado');
  await scheduler.stop();
  server.close(async () => {
    await Promise.race([background.drain(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await rateLimitStores.close();
    await db.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
