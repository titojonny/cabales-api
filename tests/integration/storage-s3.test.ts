import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  S3FileStorageProvider,
  newStorageKey,
} from '../../src/infrastructure/storage.js';

const endpoint = process.env['TEST_S3_ENDPOINT'];
const bucket = process.env['TEST_S3_BUCKET'];
const accessKeyId = process.env['TEST_S3_ACCESS_KEY_ID'];
const secretAccessKey = process.env['TEST_S3_SECRET_ACCESS_KEY'];
const region = process.env['TEST_S3_REGION'];
const configured = Boolean(endpoint && bucket && accessKeyId && secretAccessKey && region);

describe.skipIf(!configured)('Integración S3/MinIO', () => {
  it('sube, descarga, firma y borra un objeto', async () => {
    const client = new S3Client({
      endpoint: endpoint!,
      region: region!,
      forcePathStyle: true,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    try {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket! }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket! }));
      }
      const storage = new S3FileStorageProvider({
        endpoint: endpoint!,
        region: region!,
        bucket: bucket!,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        forcePathStyle: true,
        timeoutMs: 5000,
      });
      const key = newStorageKey('documents');
      const bytes = Buffer.from('%PDF-1.7 local minio test');
      await storage.put(key, bytes, 'application/pdf');
      await expect(storage.get(key)).resolves.toEqual(bytes);
      const signed = await storage.signedDownloadUrl(
        { key, fileName: 'test.pdf', mimeType: 'application/pdf' },
        60,
      );
      expect(new URL(signed.url).searchParams.has('X-Amz-Signature')).toBe(true);
      await expect(fetch(signed.url)).resolves.toMatchObject({ ok: true });
      await storage.delete(key);
      await expect(storage.get(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      client.destroy();
    }
  });
});
