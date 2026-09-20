import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
  type UploadFile,
} from '../src/services/storage.js';

type Sendable = { send: (command: { input: Record<string, unknown> }) => Promise<unknown> };

function mockFile(originalname: string, mimetype: string, body: string): UploadFile {
  return { originalname, mimetype, buffer: Buffer.from(body) };
}

describe('Capa de Almacenamiento Desacoplada (Fase 4: Storage)', () => {
  const testDir = path.join(process.cwd(), 'uploads_test_temp');

  beforeEach(async () => {
    if (!fs.existsSync(testDir)) {
      await fsPromises.mkdir(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    if (fs.existsSync(testDir)) {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    }
  });

  describe('LocalStorageProvider', () => {
    it('almacena archivos con buffer en disco y genera la URL local correcta', async () => {
      const provider = new LocalStorageProvider(testDir);
      const result = await provider.upload(
        mockFile('recibo_transferencia.png', 'image/png', 'contenido-binario-falso'),
        'comprobantes',
      );

      expect(result.provider).toBe('local');
      expect(result.key).toMatch(/^comprobantes\/proof-\d+-[a-f0-9]+\.png$/);
      expect(result.url).toBe(`/uploads/${result.key}`);

      const fullPath = path.join(testDir, result.key);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = await fsPromises.readFile(fullPath);
      expect(content.toString()).toBe('contenido-binario-falso');

      await provider.delete(result.key);
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('devuelve la URL pública local consistente', () => {
      const provider = new LocalStorageProvider(testDir);
      expect(provider.getUrl('comprobantes/test.jpg')).toBe('/uploads/comprobantes/test.jpg');
    });
  });

  describe('S3StorageProvider (Cloudflare R2 / AWS S3)', () => {
    it('genera URLs públicas usando publicUrl (Cloudflare R2 CDN)', () => {
      const provider = new S3StorageProvider({
        bucket: 'cabales-bucket',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
        publicUrl: 'https://cdn.cabales.app',
      });

      expect(provider.getUrl('comprobantes/recibo123.jpg')).toBe(
        'https://cdn.cabales.app/comprobantes/recibo123.jpg',
      );
    });

    it('genera URLs usando endpoint directo si no hay publicUrl', () => {
      const provider = new S3StorageProvider({
        bucket: 'mi-bucket',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'https://minio.midominio.com',
      });

      expect(provider.getUrl('comprobantes/recibo123.jpg')).toBe(
        'https://minio.midominio.com/mi-bucket/comprobantes/recibo123.jpg',
      );
    });

    it('genera URLs estándar de AWS S3 si solo se especifica bucket y región', () => {
      const provider = new S3StorageProvider({
        bucket: 'cabales-prod',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-2',
      });

      expect(provider.getUrl('comprobantes/recibo123.jpg')).toBe(
        'https://cabales-prod.s3.us-east-2.amazonaws.com/comprobantes/recibo123.jpg',
      );
    });

    it('envía PutObjectCommand correctamente a S3/R2', async () => {
      const provider = new S3StorageProvider({
        bucket: 'cabales-r2',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
        publicUrl: 'https://pub-r2.cabales.dev',
      });

      const client = (provider as unknown as { client: Sendable }).client;
      const sendSpy = vi.spyOn(client, 'send').mockResolvedValueOnce({});

      const result = await provider.upload(
        mockFile('captura.webp', 'image/webp', 'fake-webp-image'),
        'comprobantes',
      );

      expect(result.provider).toBe('r2');
      expect(result.url).toMatch(/^https:\/\/pub-r2\.cabales\.dev\/comprobantes\/proof-/);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sentCommand = sendSpy.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(sentCommand.input.Bucket).toBe('cabales-r2');
      expect(sentCommand.input.ContentType).toBe('image/webp');
      expect(sentCommand.input.Body).toEqual(Buffer.from('fake-webp-image'));
    });
  });

  describe('createStorageProvider (Factory)', () => {
    it('por defecto devuelve LocalStorageProvider si no hay credenciales S3', () => {
      const provider = createStorageProvider({ STORAGE_DRIVER: 'local' });
      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('devuelve S3StorageProvider cuando se configuran credenciales', () => {
      const provider = createStorageProvider({
        STORAGE_DRIVER: 'r2',
        S3_BUCKET: 'mi-r2-bucket',
        S3_ACCESS_KEY_ID: 'clave-r2',
        S3_SECRET_ACCESS_KEY: 'secreto-r2',
        S3_ENDPOINT: 'https://mi-cuenta.r2.cloudflarestorage.com',
      });
      expect(provider).toBeInstanceOf(S3StorageProvider);
    });
  });
});
