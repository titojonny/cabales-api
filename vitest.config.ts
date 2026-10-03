import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las suites de integracion comparten TEST_DATABASE_URL y limpian sus tablas al iniciar.
    // Evita que dos resets concurrentes mezclen el estado de sus escenarios.
    fileParallelism: false,
  },
});
