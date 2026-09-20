import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

/** Resultado canónico de una subida de comprobante. */
export interface StorageResult {
  key: string;
  url: string;
  provider: 'local' | 's3' | 'r2';
}

/** Archivo en memoria o en disco, sin acoplar el puerto a Express. */
export interface UploadFile {
  originalname: string;
  mimetype: string;
  buffer?: Buffer;
  path?: string;
}

/** Puerto de almacenamiento desacoplado del transporte HTTP. */
export interface StorageProvider {
  upload(file: UploadFile, folder?: string): Promise<StorageResult>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

/** Credenciales y extremos de un bucket compatible con S3. */
export interface S3Config {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string | undefined;
  region?: string | undefined;
  publicUrl?: string | undefined;
  forcePathStyle?: boolean | undefined;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

function safeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  return IMAGE_EXTENSIONS.includes(ext) ? ext : '.jpg';
}

/** Proveedor de almacenamiento en disco local para desarrollo y fallback. */
export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'uploads');
  }

  async upload(file: UploadFile, folder: string = 'comprobantes'): Promise<StorageResult> {
    const targetDir = path.join(this.baseDir, folder);
    if (!fs.existsSync(targetDir)) {
      await fsPromises.mkdir(targetDir, { recursive: true });
    }

    const filename = `proof-${Date.now()}-${randomUUID().slice(0, 8)}${safeExtension(file.originalname)}`;
    const filePath = path.join(targetDir, filename);

    if (file.buffer) {
      await fsPromises.writeFile(filePath, file.buffer);
    } else if (file.path) {
      await fsPromises.copyFile(file.path, filePath);
    } else {
      throw new Error('El archivo no contiene buffer ni ruta fisica para ser almacenado');
    }

    const key = `${folder}/${filename}`;
    return { key, url: `/uploads/${key}`, provider: 'local' };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    if (fs.existsSync(filePath)) {
      await fsPromises.unlink(filePath);
    }
  }

  getUrl(key: string): string {
    return `/uploads/${key}`;
  }
}

/** Proveedor compatible con AWS S3, Cloudflare R2 y MinIO. */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private config: S3Config;
  private isR2: boolean;

  constructor(config: S3Config) {
    this.config = config;
    this.isR2 = Boolean(config.endpoint?.includes('r2.cloudflarestorage.com'));

    const s3Config: S3ClientConfig = {
      region: config.region || (this.isR2 ? 'auto' : 'us-east-1'),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    this.client = new S3Client(s3Config);
  }

  async upload(file: UploadFile, folder: string = 'comprobantes'): Promise<StorageResult> {
    if (!file.buffer) {
      throw new Error('El proveedor S3 requiere que el archivo este en memoria (file.buffer)');
    }

    const filename = `proof-${Date.now()}-${randomUUID().slice(0, 8)}${safeExtension(file.originalname)}`;
    const key = `${folder}/${filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      key,
      url: this.getUrl(key),
      provider: this.isR2 ? 'r2' : 's3',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  getUrl(key: string): string {
    if (this.config.publicUrl) {
      const base = this.config.publicUrl.replace(/\/+$/, '');
      return `${base}/${key}`;
    }

    if (this.config.endpoint) {
      const endpoint = this.config.endpoint.replace(/\/+$/, '');
      return `${endpoint}/${this.config.bucket}/${key}`;
    }

    return `https://${this.config.bucket}.s3.${this.config.region || 'us-east-1'}.amazonaws.com/${key}`;
  }
}

/** Elige disco local o S3/R2 según STORAGE_DRIVER y credenciales. */
export function createStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const driver = env.STORAGE_DRIVER?.toLowerCase();
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  const hasS3Credentials = Boolean(bucket && accessKeyId && secretAccessKey);

  if (
    (driver === 's3' || driver === 'r2' || hasS3Credentials) &&
    accessKeyId &&
    secretAccessKey &&
    bucket
  ) {
    const s3Config: S3Config = {
      bucket,
      accessKeyId,
      secretAccessKey,
      region: env.S3_REGION || 'auto',
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    };

    if (env.S3_ENDPOINT) {
      s3Config.endpoint = env.S3_ENDPOINT;
    }
    if (env.S3_PUBLIC_URL) {
      s3Config.publicUrl = env.S3_PUBLIC_URL;
    }

    return new S3StorageProvider(s3Config);
  }

  return new LocalStorageProvider();
}

export const storage = createStorageProvider();
