import { createPublicKey, createVerify } from 'node:crypto';
import { z } from 'zod';
import { ExternalProviderError } from './errors.js';
import { AppError } from '../shared/errors.js';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const tokenResponseSchema = z.object({ id_token: z.string().min(1).max(16_384) });
const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kid: z.string().min(1).max(200),
      kty: z.literal('RSA'),
      alg: z.literal('RS256'),
      use: z.literal('sig').optional(),
      n: z.string().min(1).max(4096),
      e: z.string().min(1).max(32),
    }),
  ),
});

const claimsSchema = z.object({
  iss: z.string().max(200),
  sub: z.string().min(1).max(255),
  aud: z.union([z.string().min(1).max(512), z.array(z.string().min(1).max(512)).min(1)]),
  azp: z.string().min(1).max(512).optional(),
  exp: z.number().int(),
  iat: z.number().int().optional(),
  nonce: z.string().min(16).max(512),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  name: z.string().trim().min(1).max(120).optional(),
  picture: z.string().url().max(2048).optional(),
});

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface GoogleOAuthProvider {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<string>;
  verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity>;
}

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function decodePart(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new AppError(400, 'GOOGLE_ID_TOKEN_INVALID', 'La identidad de Google no es valida');
  }
}

function invalidToken(): never {
  throw new AppError(400, 'GOOGLE_ID_TOKEN_INVALID', 'La identidad de Google no es valida');
}

/** Cliente OIDC de Google con validación local de la firma RS256 y claims obligatorios. */
export class GoogleOAuthClient implements GoogleOAuthProvider {
  private readonly fetchImpl: typeof fetch;
  private keyCache?: { expiresAt: number; keys: z.infer<typeof jwksSchema>['keys'] };

  constructor(private readonly settings: GoogleOAuthSettings) {
    this.fetchImpl = settings.fetchImpl ?? fetch;
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          code,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          redirect_uri: this.settings.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ExternalProviderError('google', 'code_exchange_failed', true);
      const payload = tokenResponseSchema.safeParse(await response.json().catch(() => null));
      if (!payload.success) throw new ExternalProviderError('google', 'missing_id_token');
      return payload.data.id_token;
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError('google', 'unavailable', true);
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
    const pieces = idToken.split('.');
    if (pieces.length !== 3) invalidToken();
    const header = z
      .object({
        alg: z.literal('RS256'),
        kid: z.string().min(1).max(200),
        typ: z.string().optional(),
      })
      .safeParse(decodePart(pieces[0]!));
    if (!header.success) invalidToken();
    const claims = claimsSchema.safeParse(decodePart(pieces[1]!));
    if (!claims.success) invalidToken();
    const data = claims.data;
    if (!GOOGLE_ISSUERS.has(data.iss)) invalidToken();
    const audiences = Array.isArray(data.aud) ? data.aud : [data.aud];
    if (!audiences.includes(this.settings.clientId)) invalidToken();
    if (audiences.length > 1 && data.azp !== this.settings.clientId) invalidToken();
    if (data.exp <= Math.floor(Date.now() / 1000) || data.nonce !== expectedNonce) invalidToken();

    const keys = await this.getKeys();
    const jwk = keys.find((key) => key.kid === header.data.kid);
    if (!jwk) invalidToken();
    let valid: boolean;
    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${pieces[0]}.${pieces[1]}`);
      verifier.end();
      // Node acepta el JWK publico con los campos criptograficos necesarios;
      // no propagamos metadatos opcionales cuya forma cambia entre versiones.
      const publicKeyJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e };
      valid = verifier.verify(
        createPublicKey({ key: publicKeyJwk, format: 'jwk' }),
        Buffer.from(pieces[2]!, 'base64url'),
      );
    } catch {
      valid = false;
    }
    if (!valid) invalidToken();

    return {
      subject: data.sub,
      email: data.email.trim().toLowerCase(),
      emailVerified: true,
      ...(data.name ? { displayName: data.name } : {}),
      ...(data.picture ? { avatarUrl: data.picture } : {}),
    };
  }

  private async getKeys() {
    if (this.keyCache && this.keyCache.expiresAt > Date.now()) return this.keyCache.keys;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const response = await this.fetchImpl(GOOGLE_JWKS_ENDPOINT, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new ExternalProviderError('google', 'jwks_unavailable', true);
      const parsed = jwksSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new ExternalProviderError('google', 'invalid_jwks');
      const cacheControl = response.headers.get('cache-control') ?? '';
      const maxAge = Number(/max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 300);
      this.keyCache = {
        keys: parsed.data.keys,
        expiresAt: Date.now() + Math.min(Math.max(maxAge, 60), 3600) * 1000,
      };
      return parsed.data.keys;
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError('google', 'unavailable', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
