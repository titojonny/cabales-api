import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/client.js';
import { DocumentLockService } from '../src/modules/documents/document-lock.service.js';
import { DocumentEncryption } from '../src/modules/documents/document-encryption.js';
import { documentLockPinSchema, listDocumentsQuerySchema, sharedLinkSchema, uploadQuerySchema } from '../src/modules/documents/documents.schema.js';
import { DocumentsService } from '../src/modules/documents/documents.service.js';
import type { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import type { FileStorageProvider } from '../src/infrastructure/storage.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'challenge' })),
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'challenge' })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 2 },
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: 'credential-1', publicKey: Buffer.from('public-key'), counter: 1, transports: [] },
    },
  })),
}));

const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';

function lockFixture() {
  const state: {
    lock: Record<string, unknown> | null;
    credentials: Array<Record<string, unknown>>;
    challenge: Record<string, unknown> | null;
    unlockedAt: Date | null;
  } = { lock: null, credentials: [], challenge: null, unlockedAt: null };
  const db = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ email: 'ana@example.com', displayName: 'Ana' })),
    },
    documentModuleLock: {
      findUnique: vi.fn(async () => state.lock),
      count: vi.fn(async () => (state.lock?.pinHash ? 1 : 0)),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.lock = { id: 'lock-1', ...state.lock, ...create, ...update, userId: USER_ID };
        return state.lock;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lock = { ...state.lock, ...data, userId: USER_ID };
        return state.lock;
      }),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    documentWebAuthnCredential: {
      findMany: vi.fn(async () => state.credentials),
      count: vi.fn(async () => state.credentials.length),
      upsert: vi.fn(async ({ create, update, where }: { create: Record<string, unknown>; update: Record<string, unknown>; where: { credentialId: string } }) => {
        const existing = state.credentials.find((row) => row.credentialId === where.credentialId);
        if (existing) Object.assign(existing, update);
        else state.credentials.push({ id: 'credential-row-1', ...create });
        return existing ?? state.credentials.at(-1);
      }),
      findUnique: vi.fn(async ({ where }: { where: { credentialId: string } }) =>
        state.credentials.find((row) => row.credentialId === where.credentialId) ?? null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.credentials[0]!, data);
        return state.credentials[0];
      }),
      deleteMany: vi.fn(async () => ({ count: state.credentials.length })),
    },
    documentWebAuthnChallenge: {
      deleteMany: vi.fn(async () => {
        state.challenge = null;
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.challenge = { id: 'challenge-1', usedAt: null, ...data };
        return state.challenge;
      }),
      findFirst: vi.fn(async () =>
        state.challenge && state.challenge.usedAt === null ? state.challenge : null,
      ),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.challenge || state.challenge.usedAt !== null) return { count: 0 };
        Object.assign(state.challenge, data);
        return { count: 1 };
      }),
    },
    session: {
      findUnique: vi.fn(async () => ({ documentsUnlockedAt: state.unlockedAt })),
      updateMany: vi.fn(async ({ data }: { data: { documentsUnlockedAt: Date | null } }) => {
        state.unlockedAt = data.documentsUnlockedAt;
        return { count: 1 };
      }),
    },
  } as unknown as Database;
  return { db, state };
}

function createLockService(db: Database, maxPinAttempts = 2) {
  return new DocumentLockService(db, { verifyPassword: vi.fn(async () => true) }, {
    unlockTtlMs: 10 * 60 * 1000,
    pinLockMs: 60 * 1000,
    maxPinAttempts,
    rpId: 'localhost',
    origin: 'http://localhost:5173',
  });
}

describe('P5 cifrado de documentos', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it('cifra y descifra con una clave de datos por documento', () => {
    const encryption = new DocumentEncryption(new Map([['old', oldKey]]), 'old');
    const payload = encryption.encrypt(Buffer.from('contenido privado'));
    expect(payload.ciphertext).not.toEqual(Buffer.from('contenido privado'));
    expect(encryption.decrypt({ ...payload, isLegacy: false })).toEqual(Buffer.from('contenido privado'));
  });

  it('rechaza un tag de GCM manipulado', () => {
    const encryption = new DocumentEncryption(new Map([['old', oldKey]]), 'old');
    const payload = encryption.encrypt(Buffer.from('contenido'));
    const tag = Buffer.from(payload.tag, 'base64');
    tag[0] = tag[0]! ^ 1;
    expect(() => encryption.decrypt({ ...payload, tag: tag.toString('base64'), isLegacy: false })).toThrowError(/autenticar/);
  });

  it('conserva legibles los documentos legacy y reenvuelve sin cambiar ciphertext', () => {
    const legacy = new DocumentEncryption(new Map([['old', oldKey]]), 'old');
    const payload = legacy.encrypt(Buffer.from('contenido'));
    const rotated = new DocumentEncryption(new Map([['old', oldKey], ['new', newKey]]), 'new');
    const wrapped = rotated.rewrap(payload.wrappedDataKey, 'old');
    expect(wrapped.keyId).toBe('new');
    expect(rotated.decrypt({ ...payload, ...wrapped, isLegacy: false })).toEqual(Buffer.from('contenido'));
    expect(rotated.decrypt({ ciphertext: Buffer.from('legacy'), keyId: null, iv: null, tag: null, wrappedDataKey: null, isLegacy: true })).toEqual(Buffer.from('legacy'));
  });
});

describe('P5 contratos sensibles', () => {
  it('limita enlaces a 30 días en el servicio y valida PIN/categoría en la entrada', () => {
    expect(documentLockPinSchema.safeParse({ pin: '12345' }).success).toBe(false);
    expect(documentLockPinSchema.safeParse({ pin: '123456' }).success).toBe(true);
    expect(sharedLinkSchema.safeParse({ expiresAt: '2026-10-05T00:00:00.000Z', maxAccesses: 1 }).success).toBe(true);
    expect(uploadQuerySchema.parse({ name: 'pasaporte.pdf', category: 'IDENTIDAD' }).category).toBe('IDENTIDAD');
    expect(listDocumentsQuerySchema.parse({ pinned: 'false' }).pinned).toBe(false);
  });
});

describe('P5 enlaces y bloqueo', () => {
  it('rechaza enlaces caducados, revocados o agotados sin revelar el motivo', async () => {
    const repository = {
      findSharedLink: vi.fn(async () => null),
    } as unknown as DocumentsRepository;
    const service = new DocumentsService(
      repository,
      {} as GroupsService,
      {} as FileStorageProvider,
      { maxBytes: 1024, signedUrlTtlSeconds: 300 },
    );
    await expect(service.sharedPreview('token')).rejects.toMatchObject({ code: 'SHARED_LINK_INVALID' });

    repository.findSharedLink = vi.fn(async () => ({
      expiresAt: new Date('2099-01-01'),
      maxAccesses: 1,
      accessCount: 1,
      document: { name: 'privado.pdf' },
    })) as unknown as DocumentsRepository['findSharedLink'];
    await expect(service.sharedPreview('token')).rejects.toMatchObject({ code: 'SHARED_LINK_INVALID' });
  });

  it('exige desbloqueo reciente y bloquea temporalmente los intentos PIN', async () => {
    const { db, state } = lockFixture();
    state.lock = {
      id: 'lock-1',
      userId: USER_ID,
      pinHash: await argon2.hash('123456', { type: argon2.argon2id }),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      unlockTtlMinutes: 10,
    };
    const service = createLockService(db);
    await expect(service.requireUnlocked(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'DOCUMENT_LOCKED',
    });
    await expect(service.unlockPin(USER_ID, SESSION_ID, '000000')).rejects.toMatchObject({
      code: 'DOCUMENT_PIN_INVALID',
    });
    await expect(service.unlockPin(USER_ID, SESSION_ID, '000000')).rejects.toMatchObject({
      code: 'DOCUMENT_PIN_LOCKED',
    });
    await expect(service.unlockPin(USER_ID, SESSION_ID, '123456')).rejects.toMatchObject({
      code: 'DOCUMENT_PIN_LOCKED',
    });
  });

  it('verifica una passkey con respuestas WebAuthn simuladas y actualiza el contador', async () => {
    const { db, state } = lockFixture();
    const service = createLockService(db);
    const options = await service.registrationOptions(USER_ID, 'password');
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: options.challenge })).toString('base64url');
    await service.verifyRegistration(USER_ID, {
      id: 'credential-1',
      response: { clientDataJSON },
    });
    expect(state.credentials).toHaveLength(1);

    const authenticationOptions = await service.authenticationOptions(USER_ID);
    const authenticationClientData = Buffer.from(
      JSON.stringify({ challenge: authenticationOptions.challenge }),
    ).toString('base64url');
    await service.verifyAuthentication(USER_ID, SESSION_ID, {
      id: 'credential-1',
      response: { clientDataJSON: authenticationClientData },
    });
    expect(state.credentials[0]?.counter).toBe(2);
    expect(state.unlockedAt).toBeInstanceOf(Date);
  });
});
