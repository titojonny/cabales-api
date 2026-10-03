import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { loginSchema } from '../src/modules/auth/auth.schema.js';
import { createEventSchema } from '../src/modules/events/events.schema.js';

describe('contratos Zod estrictos', () => {
  it('rechaza propiedades no declaradas', () => {
    expect(
      loginSchema.safeParse({
        email: 'ana@example.com',
        password: 'una-clave-segura-123',
        actorId: 'inyectado',
      }).success,
    ).toBe(false);
  });

  it('acepta solo enlaces HTTP o HTTPS', () => {
    const event = {
      name: 'Viaje',
      startsAt: '2026-08-21T12:00:00.000Z',
      links: [{ label: 'Mapa', url: 'https://example.com/mapa' }],
    };
    expect(createEventSchema.safeParse(event).success).toBe(true);
    expect(
      createEventSchema.safeParse({
        ...event,
        links: [{ label: 'Archivo', url: 'file:///etc/passwd' }],
      }).success,
    ).toBe(false);
    expect(
      createEventSchema.safeParse({
        ...event,
        links: [{ label: 'Inválido', url: 'no-es-url' }],
      }).success,
    ).toBe(false);
    expect(
      createEventSchema.safeParse({
        ...event,
        links: [{ label: 'Script', url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false);
  });
});

describe('configuración del proxy', () => {
  const base = { DATABASE_URL: 'postgresql://fake:fake@localhost:5432/fake' };

  it('acepta un número explícito y acotado de saltos confiables', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => loadConfig({ ...base, TRUST_PROXY: '11' })).toThrow('Configuracion invalida');
  });
});
