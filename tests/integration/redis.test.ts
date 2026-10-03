import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRateLimitStoreFactory } from '../../src/infrastructure/rate-limit.js';
import { createTestContainer, TEST_DATABASE_URL, TEST_REDIS_URL } from './harness.js';

describe.skipIf(!TEST_DATABASE_URL || !TEST_REDIS_URL)(
  'Integración Redis: límites compartidos entre instancias',
  () => {
    const factories: Array<ReturnType<typeof createRateLimitStoreFactory>> = [];
    afterAll(async () => {
      await Promise.all(factories.map((factory) => factory.close()));
    });

    it('dos instancias comparten el contador de recuperación por correo', async () => {
      const env = {
        RATE_LIMIT_STORE: 'redis',
        REDIS_URL: TEST_REDIS_URL!,
        RECOVERY_RATE_LIMIT_MAX: '2',
        RATE_LIMIT_WINDOW_MINUTES: '1',
      };
      const make = async () => {
        const stores = createRateLimitStoreFactory('redis', TEST_REDIS_URL);
        factories.push(stores);
        return createTestContainer(env, { rateLimitStores: stores });
      };
      const [one, two] = await Promise.all([make(), make()]);
      const email = `redis-${Date.now()}@example.com`;
      const send = (app: typeof one.app) =>
        request(app).post('/api/v1/auth/password-recovery/request').send({ email });
      expect((await send(one.app)).status).toBe(202);
      expect((await send(two.app)).status).toBe(202);
      const limited = await send(one.app);
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      await Promise.all([one.background.drain(), two.background.drain()]);
      await Promise.all([one.db.$disconnect(), two.db.$disconnect()]);
    });
  },
);
