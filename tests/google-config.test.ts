import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('configuracion publica de Google', () => {
  it('mantiene Google deshabilitado sin credenciales completas', () => {
    expect(loadConfig(base).googleEnabled).toBe(false);
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'client-id' })).toThrow(
      /deben declararse juntos/,
    );
  });

  it('habilita Google solo con redirect URI completo y exige HTTPS en produccion', () => {
    expect(
      loadConfig({
        ...base,
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret-long-enough',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/google/callback',
      }).googleEnabled,
    ).toBe(true);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        RATE_LIMIT_STORE: 'redis',
        REDIS_URL: 'redis://redis:6379',
        STORAGE_SIGNING_SECRET: 'x'.repeat(40),
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret-long-enough',
        GOOGLE_REDIRECT_URI: 'http://api.example.com/api/v1/auth/google/callback',
      }),
    ).toThrow(/HTTPS/);
  });
});
