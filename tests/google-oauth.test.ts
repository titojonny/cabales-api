import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthClient } from '../src/infrastructure/google-oauth.js';

const clientId = 'google-client-id.apps.googleusercontent.com';
const nonce = 'nonce-for-google-test-123456789';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: 'RSA'; n: string; e: string };

function signedIdToken(overrides: Record<string, unknown> = {}) {
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const payload = {
    iss: 'https://accounts.google.com',
    sub: 'google-subject-1',
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce,
    email: 'ana@example.com',
    email_verified: true,
    name: 'Ana',
    ...overrides,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
}

function client() {
  const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    if (String(input) !== 'https://www.googleapis.com/oauth2/v3/certs')
      return new Response(null, { status: 404 });
    return new Response(
      JSON.stringify({
        keys: [{ kid: 'test-key', kty: 'RSA', alg: 'RS256', n: publicJwk.n, e: publicJwk.e }],
      }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } },
    );
  });
  return new GoogleOAuthClient({
    clientId,
    clientSecret: 'google-client-secret-for-tests',
    redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
    timeoutMs: 1000,
    fetchImpl,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Google OAuth id_token', () => {
  it('acepta una firma RSA de prueba y valida claims OIDC', async () => {
    await expect(client().verifyIdToken(signedIdToken(), nonce)).resolves.toMatchObject({
      subject: 'google-subject-1',
      email: 'ana@example.com',
      emailVerified: true,
    });
  });

  it('rechaza nonce incorrecto aunque el JWT este firmado', async () => {
    await expect(
      client().verifyIdToken(signedIdToken(), 'nonce-distinto-123456789'),
    ).rejects.toMatchObject({ code: 'GOOGLE_ID_TOKEN_INVALID' });
  });

  it('rechaza un correo Google no verificado', async () => {
    await expect(
      client().verifyIdToken(signedIdToken({ email_verified: false }), nonce),
    ).rejects.toMatchObject({ code: 'GOOGLE_ID_TOKEN_INVALID' });
  });
});
