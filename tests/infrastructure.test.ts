import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createECDH, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import {
  emailTemplates,
  HttpEmailProvider,
  LoggingEmailProvider,
  maskEmail,
} from '../src/infrastructure/email.js';
import { ExternalProviderError } from '../src/infrastructure/errors.js';
import { outboundFetch } from '../src/infrastructure/http-client.js';
import {
  DisabledOcrProvider,
  HttpOcrProvider,
  LocalOcrProvider,
} from '../src/infrastructure/ocr.js';
import { WebPushProvider } from '../src/infrastructure/push.js';
import { RedisRateLimitStore, type RedisLike } from '../src/infrastructure/rate-limit.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import {
  ALLOWED_DOCUMENT_TYPES,
  LocalFileStorageProvider,
  newStorageKey,
} from '../src/infrastructure/storage.js';
import {
  contentDisposition,
  sanitizeFileName,
} from '../src/modules/documents/documents.service.js';

describe('correo', () => {
  it('el proveedor local no registra contenido ni enlaces', async () => {
    const write = vi.fn();
    await new LoggingEmailProvider(write).send({
      to: 'ana@example.com',
      subject: 'Hola',
      text: 'token-secreto',
    });
    expect(write).toHaveBeenCalledWith({ to: 'a***@example.com', subject: 'Hola' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('token-secreto');
    expect(maskEmail('bob@x.io')).toBe('b***@x.io');
  });

  it('las plantillas llevan el token en el fragmento y escapan HTML', () => {
    const message = emailTemplates.invitation('https://app', 'tok_123', '<b>Viaje</b>', 'Ana', 7);
    expect(message.text).toContain('https://app/app/invitations/accept#token=tok_123');
    expect(message.html).not.toContain('<b>Viaje</b>');
    expect(emailTemplates.resetPassword('https://app', 'abc', 30).text).toContain(
      '/reset-password#token=abc',
    );
  });

  it('reintenta 5xx y no reintenta 4xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const provider = new HttpEmailProvider({
      url: 'https://mail',
      apiKey: 'k'.repeat(20),
      from: 'a@b.c',
      timeoutMs: 1000,
      fetchImpl,
    });
    await provider.send({ to: 'x@y.z', subject: 's', text: 't' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const rejecting = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(
      outboundFetch(
        'https://mail',
        {},
        { provider: 'email', timeoutMs: 1000, fetchImpl: rejecting },
      ),
    ).rejects.toMatchObject({ code: 'HTTP_401', retryable: false });
    expect(rejecting).toHaveBeenCalledTimes(1);
  });

  it('traduce fallos de red a un código estable tras agotar intentos', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      outboundFetch(
        'https://x',
        {},
        { provider: 'ocr', timeoutMs: 100, retries: 1, fetchImpl: failing },
      ),
    ).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('OCR', () => {
  it('el doble local falla explícitamente sin inventar datos', async () => {
    await expect(new DisabledOcrProvider().extract()).rejects.toMatchObject({
      code: 'OCR_PROVIDER_DISABLED',
    });
  });

  it('valida la respuesta del proveedor HTTP', async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(
        Response.json({ merchant: 'Café', totalCents: 1250, currency: 'USD', extra: 'x' }),
      );
    const provider = new HttpOcrProvider({ url: 'https://ocr', timeoutMs: 1000, fetchImpl: ok });
    await expect(
      provider.extract({ bytes: Buffer.from('x'), mimeType: 'image/png' }),
    ).resolves.toMatchObject({
      merchant: 'Café',
      totalCents: 1250,
      items: [],
    });
    const bad = vi.fn().mockResolvedValue(Response.json({ totalCents: -5 }));
    await expect(
      new HttpOcrProvider({ url: 'https://ocr', timeoutMs: 1000, fetchImpl: bad }).extract({
        bytes: Buffer.from('x'),
        mimeType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(ExternalProviderError);
  });

  it('el proveedor local es determinista y queda marcado como local', async () => {
    const provider = new LocalOcrProvider();
    const first = await provider.extract({ bytes: Buffer.from('fixture'), mimeType: 'image/png' });
    const second = await provider.extract({ bytes: Buffer.from('fixture'), mimeType: 'image/png' });
    expect(provider.name).toBe('local');
    expect(first).toEqual(second);
    expect(first.merchant).toContain('solo desarrollo');
    expect(first.confidence).toBe(0);
  });
});

describe('Web Push', () => {
  it('usa un emisor simulado, reintenta 5xx y no expone secretos', async () => {
    const sendImpl = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ statusCode: 201 });
    const keys = webpush.generateVAPIDKeys();
    const provider = new WebPushProvider({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'mailto:test@example.com',
      timeoutMs: 1000,
      retries: 1,
      sendImpl,
    });
    await expect(
      provider.send(
        {
          endpoint: 'https://push.example/subscription',
          p256dh: 'p'.repeat(87),
          auth: 'a'.repeat(22),
        },
        { title: 'Aviso', body: 'Hola' },
      ),
    ).resolves.toBe(true);
    expect(sendImpl).toHaveBeenCalledTimes(2);
    expect(provider.publicKey).toBe(keys.publicKey);
    expect(JSON.stringify(sendImpl.mock.calls)).not.toContain(keys.privateKey);
  });

  it('envía contra un servidor HTTP local con VAPID generado en tiempo de prueba', async () => {
    const vapid = webpush.generateVAPIDKeys();
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const received: Array<Record<string, string | string[] | undefined>> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          authorization: request.headers.authorization,
          contentEncoding: request.headers['content-encoding'],
          ttl: request.headers.ttl,
          body: Buffer.concat(chunks).toString('base64'),
        });
        response.writeHead(201).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Servidor de prueba sin puerto');
      const provider = new WebPushProvider({
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
        subject: 'mailto:test@example.com',
        timeoutMs: 2000,
        retries: 0,
      });
      await expect(
        provider.send(
          {
            endpoint: `http://127.0.0.1:${address.port}/push`,
            p256dh: ecdh.getPublicKey().toString('base64url'),
            auth: randomBytes(16).toString('base64url'),
          },
          { title: 'Prueba local', body: 'Contenido de prueba' },
        ),
      ).resolves.toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        authorization: expect.stringMatching(/^vapid /i),
        contentEncoding: 'aes128gcm',
        ttl: '3600',
      });
      expect(received[0]?.body).toEqual(expect.any(String));
      expect(received[0]?.body).not.toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('marca una suscripción 410 para limpieza', async () => {
    const endpoint = 'https://push.example/subscription';
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ isActive: true, emailVerifiedAt: null, email: 'a@b.c' }),
      },
      notificationPreference: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { type: 'settlement.created', inApp: false, email: false, push: true },
          ]),
      },
      notification: { create: vi.fn() },
      pushSubscription: {
        findMany: vi.fn().mockResolvedValue([
          {
            userId: 'user-1',
            endpoint,
            p256dh: ecdh.getPublicKey().toString('base64url'),
            auth: randomBytes(16).toString('base64url'),
          },
        ]),
        deleteMany,
      },
    };
    const vapid = webpush.generateVAPIDKeys();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 410 }));
    const push = new WebPushProvider({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      subject: 'mailto:test@example.com',
      timeoutMs: 1000,
      retries: 0,
      fetchImpl,
    });

    await new NotificationsService(db as never, { push, appOrigin: 'https://app.example' }).notify({
      userIds: ['user-1'],
      type: 'settlement.created',
      title: 'Aviso',
      body: 'Contenido',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', endpoint } });
  });
});

describe('almacenamiento local', () => {
  it('guarda, firma, verifica y rechaza manipulación o expiración', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cabales-storage-'));
    try {
      const storage = new LocalFileStorageProvider(dir, 's'.repeat(40), 'https://api.example');
      const key = newStorageKey('documents');
      await storage.put(key, Buffer.from('%PDF-1.4'));
      expect((await storage.get(key)).toString()).toBe('%PDF-1.4');
      const { url } = storage.signedDownloadUrl(
        { key, fileName: 'a.pdf', mimeType: 'application/pdf' },
        60,
      );
      const token = url.split('/').at(-1)!;
      expect(storage.verify(token)?.key).toBe(key);
      expect(storage.verify(`${token.slice(0, -2)}xx`)).toBeNull();
      expect(storage.verify(token, Date.now() + 61_000)).toBeNull();
      const other = new LocalFileStorageProvider(dir, 'o'.repeat(40), 'https://api.example');
      expect(other.verify(token)).toBeNull();
      await expect(storage.get('../../etc/passwd')).rejects.toMatchObject({ code: 'INVALID_KEY' });
      await storage.delete(key);
      await expect(storage.get(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('detecta el tipo real por firma binaria', () => {
    expect(ALLOWED_DOCUMENT_TYPES['application/pdf']!(Buffer.from('%PDF-1.7'))).toBe(true);
    expect(ALLOWED_DOCUMENT_TYPES['image/png']!(Buffer.from('%PDF-1.7'))).toBe(false);
    expect(ALLOWED_DOCUMENT_TYPES['image/jpeg']!(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it('sanea nombres y construye Content-Disposition seguro', () => {
    expect(sanitizeFileName('../../boleta "final".pdf')).toBe(
      '_.._boleta _final_.pdf'.replace(/^\./, ''),
    );
    expect(sanitizeFileName('\u0000')).toBe('_');
    expect(contentDisposition('recibo ñ.pdf')).toBe(
      `attachment; filename="recibo _.pdf"; filename*=UTF-8''recibo%20%C3%B1.pdf`,
    );
  });
});

describe('store Redis de límites', () => {
  it('usa un script atómico con prefijo por limitador y falla cerrado', async () => {
    const calls: unknown[][] = [];
    const client: RedisLike = {
      eval: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
        return [3, 5000];
      }),
      decr: vi.fn(async () => 2),
      del: vi.fn(async () => 1),
    };
    const store = new RedisRateLimitStore(client, 'auth-ip');
    store.init({ windowMs: 60_000 } as never);
    const result = await store.increment('ip:1.2.3.4');
    expect(result.totalHits).toBe(3);
    expect(calls[0]![2]).toBe('cabales:rl:auth-ip:ip:1.2.3.4');
    expect(calls[0]![3]).toBe(60_000);
    const broken = new RedisRateLimitStore(
      { eval: vi.fn().mockRejectedValue(new Error('down')), decr: vi.fn(), del: vi.fn() },
      'x',
    );
    await expect(broken.increment('k')).rejects.toMatchObject({
      status: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  });
});
