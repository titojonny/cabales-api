import { loadConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createDatabase } from '../database/client.js';
import { RetentionService } from '../modules/privacy/retention.service.js';

/**
 * Ejecuta la retención manualmente o desde un programador externo (cron, Kubernetes CronJob).
 * Uso: `pnpm job:retention [--dry-run] [--scheduled]`.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDatabase(config.DATABASE_URL);
  const dryRun = process.argv.includes('--dry-run');
  const trigger = process.argv.includes('--scheduled') ? 'SCHEDULED' : 'MANUAL';
  try {
    const result = await new RetentionService(db, config.retention).run({ trigger, dryRun });
    logger.info(result, 'Retencion completada');
  } catch (error) {
    logger.error({ code: 'RETENTION_FAILED', name: (error as Error)?.name }, 'Retencion fallida');
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
