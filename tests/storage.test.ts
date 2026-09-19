import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import {
  LocalStorageProvider,
  S3StorageProvider,
  createStorageProvider
} from '../src/services/storage.js';

describe('Capa de Almacenamiento Desacoplada (Fase 4: Storage)', () => {
  const testDir = path.join(process.cwd(), 'uploads_test_temp');

  beforeEach(async () => {
    if (!fs.existsSync(testDir)) {
      await fsPromises.mkdir(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testDir)) {
        await fsPromises.rm(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorar errores de limpieza
    }
  });

  describe('LocalStorageProvider', () => {
    it('almacena archivos con buffer en disco y genera la URL local correcta', async () => {
      const provider = new LocalStorageProvider(testDir);
      const mockFile: Express.Multer.File = {
        fieldname: 'comprobante',
        originalname: 'recibo_transferencia.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('contenido-binario-falso'),
        stream: null as any,
        destination: '',
        filename: '',
        path: ''
      };

      const result = await provider.upload(mockFile, 'comprobantes');

      expect(result.provider).toBe('local');
      expect(result.key).toMatch(/^comprobantes\/proof-\d+-[a-f0-9]+\.png$/);
      expect(result.url).toBe(`/uploads/${result.key}`);

      // Comprobar que el archivo se escribió físicamente
      const fullPath = path.join(testDir, result.key);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = await fsPromises.readFile(fullPath);
      expect(content.toString()).toBe('contenido-binario-falso');

      // Comprobar borrado
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
        publicUrl: 'https://cdn.cabales.app'
      });

      const url = provider.getUrl('comprobantes/recibo123.jpg');
      expect(url).toBe('https://cdn.cabales.app/comprobantes/recibo123.jpg');
    });

    it('genera URLs usando endpoint directo si no hay publicUrl', () => {
      const provider = new S3StorageProvider({
        bucket: 'mi-bucket',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'https://minio.midominio.com'
      });

      const url = provider.getUrl('comprobantes/recibo123.jpg');
      expect(url).toBe('https://minio.midominio.com/mi-bucket/comprobantes/recibo123.jpg');
    });

    it('genera URLs estándar de AWS S3 si solo se especifica bucket y región', () => {
      const provider = new S3StorageProvider({
        bucket: 'cabales-prod',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-2'
      });

      const url = provider.getUrl('comprobantes/recibo123.jpg');
      expect(url).toBe('https://cabales-prod.s3.us-east-2.amazonaws.com/comprobantes/recibo123.jpg');
    });

    it('envía PutObjectCommand correctamente a S3/R2', async () => {
      const provider = new S3StorageProvider({
        bucket: 'cabales-r2',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
        publicUrl: 'https://pub-r2.cabales.dev'
      });

      // Espiar el método send del cliente S3 interno
      const sendSpy = vi.spyOn((provider as any).client, 'send').mockResolvedValueOnce({} as any);

      const mockFile: Express.Multer.File = {
        fieldname: 'comprobante',
        originalname: 'captura.webp',
        encoding: '7bit',
        mimetype: 'image/webp',
        size: 2048,
        buffer: Buffer.from('fake-webp-image'),
        stream: null as any,
        destination: '',
        filename: '',
        path: ''
      };

      const result = await provider.upload(mockFile, 'comprobantes');

      expect(result.provider).toBe('r2');
      expect(result.url).toMatch(/^https:\/\/pub-r2\.cabales\.dev\/comprobantes\/proof-/);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sentCommand = sendSpy.mock.calls[0][0];
      expect(sentCommand.input.Bucket).toBe('cabales-r2');
      expect(sentCommand.input.ContentType).toBe('image/webp');
      expect(sentCommand.input.Body).toEqual(Buffer.from('fake-webp-image'));
    });
  });

  describe('createStorageProvider (Factory)', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('por defecto devuelve LocalStorageProvider si no hay credenciales S3', () => {
      delete process.env.S3_BUCKET;
      delete process.env.S3_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_ACCESS_KEY;
      process.env.STORAGE_DRIVER = 'local';

      const provider = createStorageProvider();
      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('devuelve S3StorageProvider cuando se configuran credenciales', () => {
      process.env.STORAGE_DRIVER = 'r2';
      process.env.S3_BUCKET = 'mi-r2-bucket';
      process.env.S3_ACCESS_KEY_ID = 'clave-r2';
      process.env.S3_SECRET_ACCESS_KEY = 'secreto-r2';
      process.env.S3_ENDPOINT = 'https://mi-cuenta.r2.cloudflarestorage.com';

      const provider = createStorageProvider();
      expect(provider).toBeInstanceOf(S3StorageProvider);
    });
  });
});
