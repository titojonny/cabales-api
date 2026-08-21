import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/database/client.js';

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);

/** Inserta únicamente catálogos públicos; nunca crea credenciales predeterminadas. */
async function seed(): Promise<void> {
  const achievements = [
    {
      code: 'FIRST_EXPENSE',
      name: 'Primer gasto',
      description: 'Registro su primer gasto compartido.',
    },
    {
      code: 'FIRST_SETTLEMENT',
      name: 'Cuentas cabales',
      description: 'Completo su primera liquidacion.',
    },
  ];
  for (const achievement of achievements) {
    await db.achievement.upsert({
      where: { code: achievement.code },
      create: achievement,
      update: achievement,
    });
  }
}

seed()
  .catch((error: unknown) => {
    console.error(
      'Seed fallo sin exponer configuracion',
      error instanceof Error ? error.message : 'error desconocido',
    );
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
