import argon2 from 'argon2';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Database } from '../../database/client.js';
import { hashToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { AuthPort } from '../auth/auth.service.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Bloqueo por usuario ligado a la sesión, con PIN Argon2 y passkeys WebAuthn. */
export class DocumentLockService {
  constructor(
    private readonly db: Database,
    private readonly auth: Pick<AuthPort, 'verifyPassword'>,
    private readonly options: {
      unlockTtlMs: number;
      pinLockMs: number;
      maxPinAttempts: number;
      rpId: string;
      origin: string;
      rpName?: string;
    },
  ) {}

  private async state(userId: string) {
    const [lock, credentials] = await Promise.all([
      this.db.documentModuleLock.findUnique({ where: { userId } }),
      this.db.documentWebAuthnCredential.findMany({ where: { userId } }),
    ]);
    return { lock, credentials };
  }

  private async verifyPassword(userId: string, password: string) {
    ensure(
      await this.auth.verifyPassword(userId, password),
      403,
      'REAUTH_FAILED',
      'La contrasena no es correcta',
    );
  }

  async status(userId: string, sessionId: string) {
    const { lock, credentials } = await this.state(userId);
    const enabled = Boolean(lock?.pinHash || credentials.length > 0);
    const ttl =
      (lock?.unlockTtlMinutes ?? Math.max(1, Math.round(this.options.unlockTtlMs / 60_000))) *
      60_000;
    const session = await this.db.session.findUnique({
      where: { id: sessionId, userId },
      select: { documentsUnlockedAt: true },
    });
    const unlockedUntil =
      enabled && session?.documentsUnlockedAt
        ? new Date(session.documentsUnlockedAt.getTime() + ttl)
        : null;
    return {
      enabled,
      pinEnabled: Boolean(lock?.pinHash),
      webauthnEnabled: credentials.length > 0,
      webauthnAvailable: true,
      unlockedUntil: unlockedUntil && unlockedUntil.getTime() > Date.now() ? unlockedUntil : null,
      unlockTtlMinutes: Math.round(ttl / 60_000),
    };
  }

  async requireUnlocked(userId: string, sessionId: string) {
    const { lock, credentials } = await this.state(userId);
    if (!lock?.pinHash && credentials.length === 0) return;
    ensure(sessionId, 423, 'DOCUMENT_LOCKED', 'Desbloquea Docs para continuar');
    const session = await this.db.session.findUnique({
      where: { id: sessionId, userId },
      select: { documentsUnlockedAt: true },
    });
    const ttl =
      (lock?.unlockTtlMinutes ?? Math.max(1, Math.round(this.options.unlockTtlMs / 60_000))) *
      60_000;
    ensure(
      session?.documentsUnlockedAt && Date.now() - session.documentsUnlockedAt.getTime() < ttl,
      423,
      'DOCUMENT_LOCKED',
      'Desbloquea Docs para continuar',
    );
  }

  async configure(
    userId: string,
    input: { password: string; pin?: string | null; unlockTtlMinutes?: number },
  ) {
    await this.verifyPassword(userId, input.password);
    const current = await this.db.documentModuleLock.findUnique({ where: { userId } });
    const pinHash =
      input.pin === undefined
        ? current?.pinHash
        : input.pin === null
          ? null
          : await argon2.hash(input.pin, { type: argon2.argon2id });
    const credentials = await this.db.documentWebAuthnCredential.count({ where: { userId } });
    ensure(
      pinHash || credentials > 0,
      422,
      'DOCUMENT_LOCK_EMPTY',
      'Configura un PIN o una passkey',
    );
    await this.db.documentModuleLock.upsert({
      where: { userId },
      create: {
        userId,
        ...(pinHash !== undefined ? { pinHash } : {}),
        unlockTtlMinutes: input.unlockTtlMinutes ?? Math.round(this.options.unlockTtlMs / 60_000),
      },
      update: {
        ...(pinHash !== undefined ? { pinHash } : {}),
        ...(input.unlockTtlMinutes !== undefined
          ? { unlockTtlMinutes: input.unlockTtlMinutes }
          : {}),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    return {
      enabled: true,
      pinEnabled: Boolean(pinHash),
      webauthnEnabled: credentials > 0,
      webauthnAvailable: true,
    };
  }

  async remove(userId: string, password: string) {
    await this.verifyPassword(userId, password);
    await this.db.$transaction([
      this.db.documentModuleLock.deleteMany({ where: { userId } }),
      this.db.documentWebAuthnCredential.deleteMany({ where: { userId } }),
      this.db.documentWebAuthnChallenge.deleteMany({ where: { userId } }),
      this.db.session.updateMany({ where: { userId }, data: { documentsUnlockedAt: null } }),
    ]);
    return { enabled: false };
  }

  private async unlockSession(userId: string, sessionId: string) {
    await this.db.session.updateMany({
      where: { id: sessionId, userId },
      data: { documentsUnlockedAt: new Date() },
    });
    return this.status(userId, sessionId);
  }

  async unlockPin(userId: string, sessionId: string, pin: string) {
    const { lock } = await this.state(userId);
    const pinHash = lock?.pinHash;
    ensure(pinHash, 400, 'DOCUMENT_PIN_NOT_CONFIGURED', 'No hay un PIN configurado');
    const now = new Date();
    ensure(
      !lock.pinLockedUntil || lock.pinLockedUntil <= now,
      429,
      'DOCUMENT_PIN_LOCKED',
      'El PIN esta bloqueado temporalmente',
    );
    if (lock.pinLockedUntil && lock.pinLockedUntil <= now) {
      await this.db.documentModuleLock.updateMany({
        where: { userId, pinLockedUntil: { lte: now } },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    }
    const valid = await argon2.verify(pinHash, pin).catch(() => false);
    if (!valid) {
      await this.db.documentModuleLock.updateMany({
        where: {
          userId,
          pinLockedUntil: null,
          pinFailedAttempts: lock.pinFailedAttempts,
        },
        data: { pinFailedAttempts: { increment: 1 } },
      });
      const latest = await this.db.documentModuleLock.findUnique({ where: { userId } });
      if (latest?.pinLockedUntil && latest.pinLockedUntil > now)
        throw new AppError(429, 'DOCUMENT_PIN_LOCKED', 'El PIN esta bloqueado temporalmente');
      if ((latest?.pinFailedAttempts ?? 0) >= this.options.maxPinAttempts) {
        await this.db.documentModuleLock.updateMany({
          where: {
            userId,
            pinLockedUntil: null,
            pinFailedAttempts: { gte: this.options.maxPinAttempts },
          },
          data: {
            pinFailedAttempts: 0,
            pinLockedUntil: new Date(now.getTime() + this.options.pinLockMs),
          },
        });
        throw new AppError(429, 'DOCUMENT_PIN_LOCKED', 'El PIN esta bloqueado temporalmente');
      }
      throw new AppError(403, 'DOCUMENT_PIN_INVALID', 'El PIN no es correcto');
    }
    await this.db.documentModuleLock.update({
      where: { userId },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    return this.unlockSession(userId, sessionId);
  }

  private async saveChallenge(
    userId: string,
    type: 'registration' | 'authentication',
    challenge: string,
  ) {
    await this.db.documentWebAuthnChallenge.deleteMany({ where: { userId, type } });
    await this.db.documentWebAuthnChallenge.create({
      data: {
        userId,
        type,
        challengeHash: hashToken(challenge),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
  }

  private async claimChallenge(
    userId: string,
    type: 'registration' | 'authentication',
    challenge: string,
  ) {
    const row = await this.db.documentWebAuthnChallenge.findFirst({
      where: {
        userId,
        type,
        challengeHash: hashToken(challenge),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    ensure(row, 400, 'WEBAUTHN_CHALLENGE_INVALID', 'El desafio WebAuthn no es valido o expiro');
    const claimed = await this.db.documentWebAuthnChallenge.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    ensure(
      claimed.count === 1,
      400,
      'WEBAUTHN_CHALLENGE_INVALID',
      'El desafio WebAuthn ya fue usado',
    );
  }

  private clientChallenge(response: Record<string, unknown>) {
    const nested = response.response as { clientDataJSON?: unknown } | undefined;
    ensure(
      typeof nested?.clientDataJSON === 'string',
      400,
      'WEBAUTHN_RESPONSE_INVALID',
      'La respuesta WebAuthn no es valida',
    );
    try {
      const parsed = JSON.parse(
        Buffer.from(nested.clientDataJSON, 'base64url').toString('utf8'),
      ) as { challenge?: unknown };
      ensure(
        typeof parsed.challenge === 'string',
        400,
        'WEBAUTHN_RESPONSE_INVALID',
        'La respuesta WebAuthn no tiene desafio',
      );
      return parsed.challenge;
    } catch {
      throw new AppError(400, 'WEBAUTHN_RESPONSE_INVALID', 'La respuesta WebAuthn no es valida');
    }
  }

  async registrationOptions(userId: string, password: string) {
    await this.verifyPassword(userId, password);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
    const existing = await this.db.documentWebAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName: this.options.rpName ?? 'Cabales',
      rpID: this.options.rpId,
      userID: Buffer.from(userId),
      userName: user.email,
      userDisplayName: user.displayName,
      attestationType: 'none',
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await this.saveChallenge(userId, 'registration', options.challenge);
    return options;
  }

  async verifyRegistration(userId: string, response: Record<string, unknown>) {
    const challenge = this.clientChallenge(response);
    await this.claimChallenge(userId, 'registration', challenge);
    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: challenge,
      expectedOrigin: this.options.origin,
      expectedRPID: this.options.rpId,
    });
    ensure(
      verification.verified && verification.registrationInfo,
      400,
      'WEBAUTHN_REGISTRATION_FAILED',
      'No se pudo registrar la passkey',
    );
    const credential = verification.registrationInfo.credential;
    const existing = await this.db.documentWebAuthnCredential.findUnique({
      where: { credentialId: credential.id },
      select: { userId: true },
    });
    ensure(
      !existing || existing.userId === userId,
      409,
      'WEBAUTHN_CREDENTIAL_OWNED',
      'La passkey ya pertenece a otra cuenta',
    );
    await this.db.documentWebAuthnCredential.upsert({
      where: { credentialId: credential.id },
      create: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
      update: {
        userId,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports ?? [],
      },
    });
    await this.db.documentModuleLock.upsert({
      where: { userId },
      create: { userId, unlockTtlMinutes: Math.round(this.options.unlockTtlMs / 60_000) },
      update: {},
    });
    return { enabled: true, webauthnEnabled: true };
  }

  async authenticationOptions(userId: string) {
    const credentials = await this.db.documentWebAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    ensure(
      credentials.length > 0,
      400,
      'DOCUMENT_PASSKEY_NOT_CONFIGURED',
      'No hay una passkey configurada',
    );
    const options = await generateAuthenticationOptions({
      rpID: this.options.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      userVerification: 'preferred',
    });
    await this.saveChallenge(userId, 'authentication', options.challenge);
    return options;
  }

  async verifyAuthentication(userId: string, sessionId: string, response: Record<string, unknown>) {
    const challenge = this.clientChallenge(response);
    await this.claimChallenge(userId, 'authentication', challenge);
    const credentialId = typeof response.id === 'string' ? response.id : '';
    const stored = await this.db.documentWebAuthnCredential.findUnique({ where: { credentialId } });
    ensure(
      stored?.userId === userId,
      403,
      'WEBAUTHN_CREDENTIAL_INVALID',
      'La passkey no es valida',
    );
    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: challenge,
      expectedOrigin: this.options.origin,
      expectedRPID: this.options.rpId,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, 'base64'),
        counter: stored.counter,
        transports: stored.transports as never,
      },
    });
    ensure(
      verification.verified,
      403,
      'WEBAUTHN_VERIFICATION_FAILED',
      'No se pudo verificar la passkey',
    );
    await this.db.documentWebAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });
    return this.unlockSession(userId, sessionId);
  }
}
