import { createCipheriv, createDecipheriv, randomBytes, type DecipherGCM } from 'node:crypto';
import { AppError, ensure } from '../../shared/errors.js';

export interface EncryptedDocumentPayload {
  ciphertext: Buffer;
  keyId: string;
  iv: string;
  tag: string;
  wrappedDataKey: string;
}

/** Sobre AES-256-GCM: una clave de datos aleatoria por documento, envuelta por una maestra. */
export class DocumentEncryption {
  constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    private readonly activeKeyId: string | undefined,
  ) {}

  get enabled(): boolean {
    return this.keys.size > 0 && Boolean(this.activeKeyId && this.keys.has(this.activeKeyId));
  }

  encrypt(plain: Buffer): EncryptedDocumentPayload {
    const keyId = this.activeKeyId;
    const master = keyId ? this.keys.get(keyId) : undefined;
    ensure(keyId && master, 503, 'DOCUMENT_ENCRYPTION_UNAVAILABLE', 'El cifrado de documentos no esta configurado');
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext,
      keyId,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      wrappedDataKey: this.wrap(dataKey, keyId, master),
    };
  }

  decrypt(input: {
    ciphertext: Buffer;
    keyId: string | null | undefined;
    iv: string | null | undefined;
    tag: string | null | undefined;
    wrappedDataKey: string | null | undefined;
    isLegacy?: boolean;
  }): Buffer {
    if (input.isLegacy) return input.ciphertext;
    ensure(
      input.keyId,
      500,
      'DOCUMENT_ENCRYPTION_METADATA_INVALID',
      'El sobre de cifrado del documento esta incompleto',
    );
    ensure(
      input.iv && input.tag && input.wrappedDataKey,
      500,
      'DOCUMENT_ENCRYPTION_METADATA_INVALID',
      'El sobre de cifrado del documento esta incompleto',
    );
    const decipher = this.createDecipher(input);
    try {
      return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
    } catch {
      throw new AppError(500, 'DOCUMENT_AUTHENTICATION_FAILED', 'No se pudo autenticar el documento');
    }
  }

  createDecipher(input: {
    keyId: string | null | undefined;
    iv: string | null | undefined;
    tag: string | null | undefined;
    wrappedDataKey: string | null | undefined;
  }): DecipherGCM {
    ensure(
      input.keyId && input.iv && input.tag && input.wrappedDataKey,
      500,
      'DOCUMENT_ENCRYPTION_METADATA_INVALID',
      'El sobre de cifrado del documento esta incompleto',
    );
    const dataKey = this.unwrap(input.wrappedDataKey, input.keyId);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(input.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(input.tag, 'base64'));
      return decipher;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'DOCUMENT_AUTHENTICATION_FAILED', 'No se pudo autenticar el documento');
    }
  }

  rewrap(wrappedDataKey: string, oldKeyId: string): { keyId: string; wrappedDataKey: string } {
    const activeKeyId = this.activeKeyId;
    const active = activeKeyId ? this.keys.get(activeKeyId) : undefined;
    ensure(activeKeyId && active, 503, 'DOCUMENT_ENCRYPTION_UNAVAILABLE', 'El cifrado de documentos no esta configurado');
    const dataKey = this.unwrap(wrappedDataKey, oldKeyId);
    return { keyId: activeKeyId, wrappedDataKey: this.wrap(dataKey, activeKeyId, active) };
  }

  private wrap(dataKey: Buffer, keyId: string, master: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', master, iv);
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return [keyId, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
  }

  private unwrap(value: string, keyId: string): Buffer {
    const master = this.keys.get(keyId);
    const [storedKeyId, iv, tag, encoded] = value.split('.');
    ensure(master && storedKeyId === keyId && iv && tag && encoded, 500, 'DOCUMENT_KEY_UNAVAILABLE', 'La clave del documento no esta disponible');
    try {
      const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const dataKey = Buffer.concat([decipher.update(Buffer.from(encoded, 'base64')), decipher.final()]);
      ensure(dataKey.length === 32, 500, 'DOCUMENT_KEY_INVALID', 'La clave de datos del documento no es valida');
      return dataKey;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'DOCUMENT_KEY_INVALID', 'La clave de datos del documento no es valida');
    }
  }
}
