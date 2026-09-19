import { S3Client, S3ClientConfig, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface StorageResult {
  key: string;
  url: string;
  provider: 'local' | 's3' | 'r2';
}

export interface StorageProvider {
  upload(file: Express.Multer.File, folder?: string): Promise<StorageResult>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

export interface S3Config {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string | undefined;
  region?: string | undefined;
  publicUrl?: string | undefined;
  forcePathStyle?: boolean | undefined;
}

/**
 * Proveedor de almacenamiento en disco local (desarrollo, pruebas y fallback offline)
 */
export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'uploads');
  }

  async upload(file: Express.Multer.File, folder: string = 'comprobantes'): Promise<StorageResult> {
    const targetDir = path.join(this.baseDir, folder);
    if (!fs.existsSync(targetDir)) {
      await fsPromises.mkdir(targetDir, { recursive: true });
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
    const filename = `proof-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
    const filePath = path.join(targetDir, filename);

    if (file.buffer) {
      await fsPromises.writeFile(filePath, file.buffer);
    } else if (file.path) {
      await fsPromises.copyFile(file.path, filePath);
    } else {
      throw new Error('El archivo no contiene buffer ni ruta física para ser almacenado');
    }

    const key = `${folder}/${filename}`;
    const url = `/uploads/${key}`;

    return {
      key,
      url,
      provider: 'local'
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    try {
      if (fs.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
      }
    } catch (err) {
      console.warn(`[Storage] No se pudo eliminar el archivo local: ${filePath}`, err);
    }
  }

  getUrl(key: string): string {
    return `/uploads/${key}`;
  }
}

/**
 * Proveedor de almacenamiento en la nube compatible con S3 (Cloudflare R2, AWS S3, MinIO, etc.)
 */
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
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: config.forcePathStyle ?? false
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    this.client = new S3Client(s3Config);
  }

  async upload(file: Express.Multer.File, folder: string = 'comprobantes'): Promise<StorageResult> {
    if (!file.buffer) {
      throw new Error('El proveedor S3 requiere que el archivo esté en memoria (file.buffer)');
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
    const filename = `proof-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
    const key = `${folder}/${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable'
    });

    await this.client.send(command);

    return {
      key,
      url: this.getUrl(key),
      provider: this.isR2 ? 'r2' : 's3'
    };
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      });
      await this.client.send(command);
    } catch (err) {
      console.warn(`[Storage S3] Error al eliminar objeto con clave: ${key}`, err);
    }
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

/**
 * Crea la instancia del proveedor de almacenamiento según las variables de entorno
 */
export function createStorageProvider(): StorageProvider {
  const driver = process.env.STORAGE_DRIVER?.toLowerCase();
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  const hasS3Credentials = Boolean(bucket && accessKeyId && secretAccessKey);

  if ((driver === 's3' || driver === 'r2' || hasS3Credentials) && accessKeyId && secretAccessKey && bucket) {
    const s3Config: S3Config = {
      bucket,
      accessKeyId,
      secretAccessKey,
      region: process.env.S3_REGION || 'auto',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
    };

    if (process.env.S3_ENDPOINT) {
      s3Config.endpoint = process.env.S3_ENDPOINT;
    }
    if (process.env.S3_PUBLIC_URL) {
      s3Config.publicUrl = process.env.S3_PUBLIC_URL;
    }

    return new S3StorageProvider(s3Config);
  }

  return new LocalStorageProvider();
}

export const storage = createStorageProvider();
