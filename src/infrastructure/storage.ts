import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ExternalProviderError } from './errors.js';

/** Metadatos incluidos en una URL firmada; nunca contiene rutas del sistema de archivos. */
export interface SignedObjectClaims {
  key: string;
  fileName: string;
  mimeType: string;
  expiresAt: number;
}

/** Puerto de almacenamiento de objetos; PostgreSQL conserva solo metadatos. */
export interface FileStorageProvider {
  readonly name: string;
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedDownloadUrl(
    claims: Omit<SignedObjectClaims, 'expiresAt'>,
    ttlSeconds: number,
  ): { url: string; expiresAt: Date } | Promise<{ url: string; expiresAt: Date }>;
}

/** Genera claves opacas no derivadas del nombre original para evitar path traversal y fugas. */
export function newStorageKey(prefix: string): string {
  return `${prefix}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Proveedor en disco local con descargas firmadas por HMAC servidas por la API. */
export class LocalFileStorageProvider implements FileStorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly secret: string,
    private readonly publicApiOrigin: string,
  ) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    if (!/^[a-z0-9-]+\/\d{4}-\d{2}\/[0-9a-f-]{36}$/.test(key)) {
      throw new ExternalProviderError('storage', 'INVALID_KEY');
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep))
      throw new ExternalProviderError('storage', 'INVALID_KEY');
    return full;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const full = this.resolve(key);
    try {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: 'wx', mode: 0o600 });
    } catch {
      throw new ExternalProviderError('storage', 'WRITE_FAILED', true);
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError('storage', 'NOT_FOUND');
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true }).catch(() => {
      throw new ExternalProviderError('storage', 'DELETE_FAILED', true);
    });
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  signedDownloadUrl(claims: Omit<SignedObjectClaims, 'expiresAt'>, ttlSeconds: number) {
    const expiresAt = Date.now() + Math.max(30, Math.min(ttlSeconds, 900)) * 1000;
    const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt })).toString('base64url');
    const token = `${payload}.${this.sign(payload)}`;
    return {
      url: `${this.publicApiOrigin.replace(/\/$/, '')}/api/v1/storage/local/${token}`,
      expiresAt: new Date(expiresAt),
    };
  }

  /** Verifica firma y expiración en tiempo constante; devuelve null ante cualquier anomalía. */
  verify(token: string, now = Date.now()): SignedObjectClaims | null {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined || token.length > 4096) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as SignedObjectClaims;
      if (
        typeof claims.expiresAt !== 'number' ||
        !Number.isFinite(claims.expiresAt) ||
        claims.expiresAt <= now
      )
        return null;
      if (
        typeof claims.key !== 'string' ||
        typeof claims.fileName !== 'string' ||
        typeof claims.mimeType !== 'string'
      )
        return null;
      return claims;
    } catch {
      return null;
    }
  }
}

/** Almacenamiento S3 compatible (incluido MinIO) con URLs presignadas de vida corta. */
export class S3FileStorageProvider implements FileStorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(
    private readonly options: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      timeoutMs: number;
    },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      maxAttempts: 2,
    });
  }

  private validateKey(key: string): string {
    if (!/^[a-z0-9-]+\/\d{4}-\d{2}\/[0-9a-f-]{36}$/.test(key))
      throw new ExternalProviderError('storage', 'INVALID_KEY');
    return key;
  }

  private async request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ExternalProviderError('storage', 'TIMEOUT', true));
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    this.validateKey(key);
    try {
      await this.request((signal) =>
        this.client
          .send(
            new PutObjectCommand({
              Bucket: this.options.bucket,
              Key: key,
              Body: bytes,
              ContentType: mimeType,
              ContentLength: bytes.length,
            }),
            { abortSignal: signal },
          )
          .then(() => undefined),
      );
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError('storage', 'WRITE_FAILED', true);
    }
  }

  async get(key: string): Promise<Buffer> {
    this.validateKey(key);
    try {
      const response = await this.request((signal) =>
        this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), {
          abortSignal: signal,
        }),
      );
      if (!response.Body) throw new ExternalProviderError('storage', 'NOT_FOUND');
      const body = response.Body as unknown as {
        transformToByteArray?: () => Promise<Uint8Array>;
      };
      if (body.transformToByteArray) return Buffer.from(await body.transformToByteArray());
      if (response.Body instanceof Uint8Array) return Buffer.from(response.Body);
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as unknown as AsyncIterable<Uint8Array | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (statusCode === 404) throw new ExternalProviderError('storage', 'NOT_FOUND');
      throw new ExternalProviderError('storage', 'READ_FAILED', true);
    }
  }

  async delete(key: string): Promise<void> {
    this.validateKey(key);
    try {
      await this.request((signal) =>
        this.client
          .send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }), {
            abortSignal: signal,
          })
          .then(() => undefined),
      );
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError('storage', 'DELETE_FAILED', true);
    }
  }

  async signedDownloadUrl(claims: Omit<SignedObjectClaims, 'expiresAt'>, ttlSeconds: number) {
    this.validateKey(claims.key);
    const expiresIn = Math.max(30, Math.min(ttlSeconds, 900));
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: claims.key,
          ResponseContentType: claims.mimeType,
          ResponseContentDisposition: `attachment; filename="${claims.fileName.replace(/["\\\r\n]/g, '_')}"`,
        }),
        { expiresIn },
      );
      return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
    } catch {
      throw new ExternalProviderError('storage', 'SIGN_FAILED', true);
    }
  }
}

/** Tipos admitidos y su firma binaria; el MIME declarado debe coincidir con el contenido. */
export const ALLOWED_DOCUMENT_TYPES: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};
