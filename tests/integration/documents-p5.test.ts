import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  Client,
  createTestContainer,
  PNG_BYTES,
  resetDatabase,
  TEST_DATABASE_URL,
} from './harness.js';

describe.skipIf(!TEST_DATABASE_URL)('Integración PostgreSQL: Docs P5', () => {
  let ctx: Awaited<ReturnType<typeof createTestContainer>>;
  let ana: Client;
  const testEmail = 'docs-p5@example.com';

  beforeAll(async () => {
    ctx = await createTestContainer({
      DOCUMENT_ENCRYPTION_KEYS: `test:${Buffer.alloc(32, 7).toString('base64')}`,
      DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID: 'test',
      SCHEDULER_ENABLED: 'false',
    });
  });

  beforeEach(async () => {
    await ctx.background.drain();
    await resetDatabase(ctx.db);
    ana = new Client(ctx.app);
    expect((await ana.register(testEmail, 'Docs P5')).status).toBe(201);
    await ctx.background.drain();
  });

  afterAll(async () => {
    await ctx?.background.drain();
    await ctx?.db.$disconnect();
  });

  it('cifra y descifra por la API', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const upload = await ana.agent
      .post('/api/v1/documents')
      .query({
        name: 'pasaporte.png',
        category: 'IDENTIDAD',
        expiresAt,
        expiryNoticeDays: '3,1',
      })
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(upload.status).toBe(201);
    const documentId = upload.body.data.id as string;
    expect(upload.body.data).toMatchObject({ category: 'IDENTIDAD', isLegacy: false });

    const stored = await ctx.db.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { encryptionKeyId: true, encryptionTag: true },
    });
    expect(stored.encryptionKeyId).toBe('test');
    const download = await ana.agent.get(`/api/v1/documents/${documentId}/download`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body)).toEqual(PNG_BYTES);
  });

  it('filtra fijados y gestiona enlaces caducables, revocables y limitados', async () => {
    const upload = await ana.agent
      .post('/api/v1/documents')
      .query({
        name: 'pasaporte.png',
        category: 'IDENTIDAD',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        expiryNoticeDays: '3,1',
      })
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(upload.status).toBe(201);
    const documentId = upload.body.data.id as string;
    expect((await ana.post(`/documents/${documentId}/pin`)).status).toBe(200);
    const pinned = await ana.get('/documents?pinned=true');
    expect(pinned.body.data.map((item: { id: string }) => item.id)).toContain(documentId);

    const publicApi = request(ctx.app);
    const link = await ana.post(`/documents/${documentId}/shared-links`, {
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      maxAccesses: 1,
    });
    expect(link.status).toBe(201);
    const token = new URL(link.body.data.url).pathname.split('/').at(-1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const preview = await publicApi.get(`/api/v1/share/documents/${token}`);
    expect(preview.body.data).toEqual({ name: 'pasaporte.png' });
    expect(JSON.stringify(preview.body.data)).not.toContain('owner');
    expect((await publicApi.get(`/api/v1/share/documents/${token}/download`)).status).toBe(200);
    expect((await publicApi.get(`/api/v1/share/documents/${token}/download`)).status).toBe(404);

    const revoked = await ana.post(`/documents/${documentId}/shared-links`, {
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const revokedToken = new URL(revoked.body.data.url).pathname.split('/').at(-1);
    expect((await ana.post(`/documents/${documentId}/shared-links/${revoked.body.data.id}/revoke`)).status).toBe(200);
    expect((await publicApi.get(`/api/v1/share/documents/${revokedToken}`)).status).toBe(404);

    const expired = await ana.post(`/documents/${documentId}/shared-links`, {
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const expiredToken = new URL(expired.body.data.url).pathname.split('/').at(-1);
    await ctx.db.documentSharedLink.update({
      where: { id: expired.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await publicApi.get(`/api/v1/share/documents/${expiredToken}`)).status).toBe(404);

    const document = await ctx.db.document.findUniqueOrThrow({ where: { id: documentId }, select: { expiresAt: true } });
    await ctx.scheduler.runNow(
      'document-expiry-notifications',
      new Date(document.expiresAt!.getTime() - 3 * 24 * 60 * 60 * 1000),
    );
    await ctx.scheduler.runNow(
      'document-expiry-notifications',
      new Date(document.expiresAt!.getTime() - 3 * 24 * 60 * 60 * 1000),
    );
    const notifications = await ana.get('/notifications?status=ACTIVE&limit=100');
    expect(
      notifications.body.data.filter((item: { type: string }) => item.type === 'document.expiring'),
    ).toHaveLength(1);
  });

  it('exige desbloqueo reciente y lo restablece al cerrar sesión', async () => {
    const configured = await ana.put('/documents/lock', {
      password: 'una-clave-segura-123',
      pin: '123456',
      unlockTtlMinutes: 10,
    });
    expect(configured.status).toBe(200);
    expect((await ana.get('/documents')).status).toBe(423);
    expect((await ana.post('/documents/lock/pin', { pin: '123456' })).status).toBe(200);
    expect((await ana.get('/documents')).status).toBe(200);
    expect((await ana.post('/auth/logout')).status).toBe(200);
    const session = await ctx.db.session.findFirst({
      where: { user: { email: testEmail } },
      select: { documentsUnlockedAt: true },
    });
    expect(session?.documentsUnlockedAt).toBeNull();
  });
});
