import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const production = {
  ...base,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://app.cabales.com',
  RATE_LIMIT_STORE: 'redis',
  REDIS_URL: 'redis://redis:6379',
  STORAGE_SIGNING_SECRET: 'x'.repeat(40),
};

describe('loadConfig', () => {
  it('usa valores seguros por defecto en desarrollo', () => {
    const config = loadConfig(base);
    expect(config.RATE_LIMIT_STORE).toBe('memory');
    expect(config.EMAIL_PROVIDER).toBe('logging');
    expect(config.OCR_PROVIDER).toBe('disabled');
    expect(config.retention.tokensMs).toBe(7 * 86_400_000);
  });

  it('exige Redis para límites distribuidos en producción', () => {
    expect(() => loadConfig({ ...production, RATE_LIMIT_STORE: 'memory' })).toThrow(
      /RATE_LIMIT_STORE=redis/,
    );
    expect(() => loadConfig({ ...production, REDIS_URL: '' })).toThrow(/REDIS_URL/);
  });

  it('exige secreto de firma robusto en producción', () => {
    expect(() => loadConfig({ ...production, STORAGE_SIGNING_SECRET: 'corto-pero-16-ch' })).toThrow(
      /STORAGE_SIGNING_SECRET/,
    );
  });

  it('rechaza comodín CORS y localhost en producción', () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(/no admite \*/);
    expect(() => loadConfig({ ...production, CORS_ORIGINS: 'http://localhost:5173' })).toThrow(
      /localhost/,
    );
  });

  it('valida proveedores externos declarados', () => {
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: 'http' })).toThrow(/EMAIL_HTTP_URL/);
    expect(() => loadConfig({ ...base, OCR_PROVIDER: 'http' })).toThrow(/OCR_HTTP_URL/);
    expect(() => loadConfig({ ...production, OCR_PROVIDER: 'local' })).toThrow(
      /solo para desarrollo y pruebas/,
    );
    expect(() => loadConfig({ ...base, PUSH_PROVIDER: 'webpush' })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: 's3' })).toThrow(/S3_ENDPOINT/);
  });

  it('advierte sin fallar si producción usa correo de registro local', () => {
    const config = loadConfig(production);
    expect(config.warnings.some((warning) => warning.includes('EMAIL_PROVIDER=logging'))).toBe(
      true,
    );
  });
});
