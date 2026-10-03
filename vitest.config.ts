import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las suites de integración comparten TEST_DATABASE_URL y cada una la limpia.
    fileParallelism: false,
  },
});
