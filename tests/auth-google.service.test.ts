import { describe, expect, it, vi } from 'vitest';
import { BackgroundTasks } from '../src/infrastructure/background.js';
import type { GoogleOAuthProvider } from '../src/infrastructure/google-oauth.js';
import type { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  displayName: 'Ana',
  avatarUrl: null,
  locale: 'es',
  emailVerified: true,
};

function serviceFixture() {
  let stateHash = '';
  let nonceHash = '';
  let intent: 'login' | 'link' = 'login';
  const repository = {
    createOAuthState: vi.fn(
      async (input: { stateHash: string; nonceHash: string; intent: 'login' | 'link' }) => {
        stateHash = input.stateHash;
        nonceHash = input.nonceHash;
        intent = input.intent;
      },
    ),
    consumeOAuthState: vi.fn(async (value: string) =>
      value === stateHash
        ? {
            id: 'oauth-state',
            nonceHash,
            intent,
            userId: intent === 'link' ? user.id : null,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
          }
        : null,
    ),
    linkOrCreateGoogle: vi.fn(async () => ({
      status: intent === 'link' ? ('linked' as const) : ('authenticated' as const),
      user,
    })),
    createSession: vi.fn(async () => undefined),
    unlinkGoogle: vi.fn(async () => 'last' as const),
  } as unknown as AuthRepository;
  const provider: GoogleOAuthProvider = {
    authorizationUrl: vi.fn(() => 'https://accounts.google.test/authorize'),
    exchangeCode: vi.fn(async () => 'signed-id-token'),
    verifyIdToken: vi.fn(async () => ({
      subject: 'google-subject',
      email: user.email,
      emailVerified: true as const,
    })),
  };
  const service = new AuthService(
    repository,
    {
      sessionTtlMs: 60_000,
      emailVerificationTtlMs: 60_000,
      passwordResetTtlMs: 60_000,
      appOrigin: 'http://localhost:5173',
    },
    { name: 'test', send: vi.fn(async () => undefined) },
    new BackgroundTasks(),
    provider,
  );
  return { service, repository, provider };
}

describe('AuthService Google', () => {
  it('rechaza state invalido y nonce invalido', async () => {
    const { service } = serviceFixture();
    const start = await service.beginGoogleAuth!('login');
    const base = {
      state: start.state,
      nonce: start.nonce,
      code: 'authorization-code',
      codeVerifier: start.codeVerifier,
      agent: {},
    };
    await expect(
      service.completeGoogleAuth!({ ...base, state: 'x'.repeat(43) }),
    ).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    await expect(
      service.completeGoogleAuth!({ ...base, nonce: 'nonce-distinto-123456789' }),
    ).rejects.toMatchObject({
      code: 'OAUTH_NONCE_INVALID',
    });
  });

  it('emite sesion para la identidad Google vinculada por el servicio', async () => {
    const { service, repository, provider } = serviceFixture();
    const start = await service.beginGoogleAuth!('login');
    const result = await service.completeGoogleAuth!({
      state: start.state,
      nonce: start.nonce,
      code: 'authorization-code',
      codeVerifier: start.codeVerifier,
      agent: {},
    });
    expect(result.session).toBeDefined();
    expect(repository.linkOrCreateGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ email: user.email, emailVerified: true }),
      undefined,
    );
    expect(provider.verifyIdToken).toHaveBeenCalledWith('signed-id-token', start.nonce);
  });

  it('vincula la identidad Google verificada al usuario autenticado', async () => {
    const { service, repository } = serviceFixture();
    const start = await service.beginGoogleAuth!('link', user.id);
    const result = await service.completeGoogleAuth!({
      state: start.state,
      nonce: start.nonce,
      code: 'authorization-code',
      codeVerifier: start.codeVerifier,
      agent: {},
    });
    expect(result.intent).toBe('link');
    expect(repository.linkOrCreateGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ email: user.email, emailVerified: true }),
      user.id,
    );
  });

  it('protege la desvinculacion del ultimo metodo de acceso', async () => {
    const { service } = serviceFixture();
    await expect(service.unlinkGoogle!('user-id')).rejects.toMatchObject({
      code: 'LAST_AUTH_METHOD',
    });
  });
});
