import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OcrProvider } from '../../src/infrastructure/ocr.js';
import { RetentionService } from '../../src/modules/privacy/retention.service.js';
import {
  Client,
  createTestContainer,
  PNG_BYTES,
  resetDatabase,
  TEST_DATABASE_URL,
} from './harness.js';

const fakeOcr: OcrProvider = {
  name: 'fake',
  async extract() {
    return {
      merchant: 'Pupusería',
      totalCents: 9000,
      subtotalCents: null,
      taxCents: null,
      tipCents: null,
      currency: 'USD',
      occurredAt: null,
      items: [],
      confidence: 0.9,
      confidenceByField: null,
    };
  },
};

describe.skipIf(!TEST_DATABASE_URL)('Integración PostgreSQL: flujo completo de módulos', () => {
  let ctx: Awaited<ReturnType<typeof createTestContainer>>;
  let ana: Client;
  let bob: Client;
  let carl: Client;
  const state: Record<string, string> = {};
  const drain = () => ctx.background.drain();

  beforeAll(async () => {
    ctx = await createTestContainer({}, { ocr: fakeOcr });
    await resetDatabase(ctx.db);
    ana = new Client(ctx.app);
    bob = new Client(ctx.app);
    carl = new Client(ctx.app);
  });

  afterAll(async () => {
    await ctx?.background.drain();
    await ctx?.db.$disconnect();
  });

  it('registra y verifica correo con token de un solo uso', async () => {
    expect((await ana.register('ana@example.com', 'Ana')).status).toBe(201);
    expect((await bob.register('bob@example.com', 'Bob')).status).toBe(201);
    expect((await carl.register('carl@example.com', 'Carl')).status).toBe(201);
    await drain();
    const token = ctx.capture.lastTokenFor('ana@example.com', 'Verifica');
    const verified = await ana.agent
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.emailVerified).toBe(true);
    const reused = await ana.agent.post('/api/v1/auth/email-verification/confirm').send({ token });
    expect(reused.body.error.code).toBe('EMAIL_TOKEN_INVALID');
    const stored = await ctx.db.emailVerificationToken.findFirst({
      where: { user: { email: 'ana@example.com' } },
    });
    expect(stored?.tokenHash).not.toBe(token);
    expect((await ana.get('/auth/me')).body.data.user.emailVerified).toBe(true);
  });

  it('gestiona invitaciones: envío, duplicado, reenvío, vista previa, aceptación', async () => {
    const group = await ana.post('/groups', { name: 'Viaje', currency: 'USD' });
    expect(group.status).toBe(201);
    state.groupId = group.body.data.id;
    const invite = await ana.post(`/groups/${state.groupId}/invitations`, {
      email: 'bob@example.com',
    });
    expect(invite.status).toBe(201);
    expect(invite.body.data.delivery).toBe('email');
    await drain();
    expect(ctx.capture.lastTokenFor('bob@example.com', 'invitó')).toBe(invite.body.data.token);
    const duplicate = await ana.post(`/groups/${state.groupId}/invitations`, {
      email: 'bob@example.com',
    });
    expect(duplicate.body.error.code).toBe('INVITATION_PENDING');
    const forbidden = await carl.get(`/groups/${state.groupId}/invitations`);
    expect(forbidden.status).toBe(404);
    const resent = await ana.post(
      `/groups/${state.groupId}/invitations/${invite.body.data.invitation.id}/resend`,
    );
    expect(resent.status).toBe(200);
    expect(resent.body.data.invitation.sendCount).toBe(2);
    expect(
      (await bob.post('/groups/invitations/preview', { token: invite.body.data.token })).status,
    ).toBe(404);
    const preview = await bob.post('/groups/invitations/preview', {
      token: resent.body.data.token,
    });
    expect(preview.body.data).toMatchObject({
      groupName: 'Viaje',
      invitedBy: 'Ana',
      emailMatches: true,
      status: 'PENDING',
    });
    const wrongUser = await carl.post('/groups/invitations/accept', {
      token: resent.body.data.token,
    });
    expect(wrongUser.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
    const accepted = await bob.post('/groups/invitations/accept', {
      token: resent.body.data.token,
    });
    expect(accepted.status).toBe(200);
    const again = await ana.post(`/groups/${state.groupId}/invitations`, {
      email: 'bob@example.com',
    });
    expect(again.body.error.code).toBe('ALREADY_MEMBER');
    const carlInvite = await ana.post(`/groups/${state.groupId}/invitations`, {
      email: 'carl-otro@example.com',
    });
    const revoked = await ana.post(
      `/groups/${state.groupId}/invitations/${carlInvite.body.data.invitation.id}/revoke`,
    );
    expect(revoked.body.data.status).toBe('REVOKED');
    const list = await ana.get(`/groups/${state.groupId}/invitations`);
    expect(list.body.data.map((item: { status: string }) => item.status).sort()).toEqual([
      'ACCEPTED',
      'REVOKED',
    ]);
    expect(JSON.stringify(list.body.data)).not.toContain('tokenHash');
    const detail = await ana.get(`/groups/${state.groupId}`);
    state.anaMember = detail.body.data.members.find(
      (m: { user: { displayName: string } }) => m.user.displayName === 'Ana',
    ).id;
    state.bobMember = detail.body.data.members.find(
      (m: { user: { displayName: string } }) => m.user.displayName === 'Bob',
    ).id;
    expect((await carl.get(`/groups/${state.groupId}`)).status).toBe(404);
  });

  it('crea categoría, evento, presupuesto y gasto con alerta de presupuesto', async () => {
    const category = await ana.post(`/groups/${state.groupId}/categories`, {
      name: 'Comida',
      color: '#ff8800',
    });
    expect(category.status).toBe(201);
    state.categoryId = category.body.data.id;
    expect((await bob.post(`/groups/${state.groupId}/categories`, { name: 'Otra' })).status).toBe(
      403,
    );
    const event = await ana.post(`/groups/${state.groupId}/events`, {
      name: 'Cena',
      startsAt: new Date().toISOString(),
      memberIds: [state.bobMember],
      guests: ['Luis'],
    });
    expect(event.status).toBe(201);
    state.eventId = event.body.data.id;
    const participants = event.body.data.participants as Array<{
      id: string;
      groupMemberId: string | null;
      guestName: string | null;
    }>;
    state.pAna = participants.find((p) => p.groupMemberId === state.anaMember)!.id;
    state.pBob = participants.find((p) => p.groupMemberId === state.bobMember)!.id;
    state.pLuis = participants.find((p) => p.guestName === 'Luis')!.id;
    const budget = await ana.post(`/groups/${state.groupId}/budgets`, {
      name: 'Comidas del mes',
      amountCents: 10_000,
      period: 'MONTHLY',
      startsAt: '2026-01-01T00:00:00.000Z',
      categoryId: state.categoryId,
      alertThresholdPercent: 50,
    });
    expect(budget.status).toBe(201);
    state.budgetId = budget.body.data.id;
    const invalidBudget = await ana.post(`/groups/${state.groupId}/budgets`, {
      name: 'Mal',
      amountCents: 100,
      period: 'CUSTOM',
      startsAt: '2026-01-01T00:00:00.000Z',
    });
    expect(invalidBudget.status).toBe(400);
    const expense = await ana.post(
      `/groups/${state.groupId}/expenses`,
      {
        eventId: state.eventId,
        title: 'Pupusas',
        totalCents: 9000,
        currency: 'USD',
        splitMode: 'EQUAL',
        categoryId: state.categoryId,
        occurredAt: new Date().toISOString(),
        participants: [
          { eventParticipantId: state.pAna },
          { eventParticipantId: state.pBob },
          { eventParticipantId: state.pLuis },
        ],
        payers: [{ eventParticipantId: state.pAna, amountCents: 9000 }],
      },
      { 'Idempotency-Key': 'expense-key-0001' },
    );
    expect(expense.status).toBe(201);
    state.expenseId = expense.body.data.id;
    await drain();
    const budgets = await bob.get(`/groups/${state.groupId}/budgets`);
    expect(budgets.body.data[0].current).toMatchObject({
      spentCents: 9000,
      alert: 'WARNING',
      remainingCents: 1000,
    });
    const budgetDetail = await ana.get(`/groups/${state.groupId}/budgets/${state.budgetId}`);
    expect(budgetDetail.body.data.history.length).toBeGreaterThan(0);
    const notifications = await ana.get('/notifications');
    expect(
      notifications.body.data.some((n: { type: string }) => n.type === 'budget.threshold'),
    ).toBe(true);
  });

  it('crea un gasto desde OCR, protege propiedad, confirmacion y grupo documental', async () => {
    const upload = await ana.agent
      .post(`/api/v1/documents?name=ocr.png&groupId=${state.groupId}`)
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(upload.status).toBe(201);
    const jobResponse = await ana.post('/ocr/jobs', { documentId: upload.body.data.id });
    expect(jobResponse.status).toBe(202);
    await drain();
    const job = await ana.get(`/ocr/jobs/${jobResponse.body.data.id}`);
    expect(job.body.data.status).toBe('SUCCEEDED');

    const expense = await ana.post(
      `/groups/${state.groupId}/expenses`,
      {
        ocrJobId: job.body.data.id,
        eventId: state.eventId,
        title: 'OCR corregido',
        totalCents: 900,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt: new Date().toISOString(),
        participants: [{ eventParticipantId: state.pAna, shareCents: 900 }],
        payers: [{ eventParticipantId: state.pAna, amountCents: 900 }],
      },
      { 'Idempotency-Key': 'ocr-expense-key-0001' },
    );
    expect(expense.status).toBe(201);
    const storedJob = await ctx.db.ocrJob.findUnique({ where: { id: job.body.data.id } });
    expect(storedJob).toMatchObject({
      status: 'SUCCEEDED',
      confirmedExpenseId: expense.body.data.id,
    });
    expect(
      (await ctx.db.document.findUnique({ where: { id: upload.body.data.id } }))?.expenseId,
    ).toBe(expense.body.data.id);

    const foreignJob = await bob.post(
      `/groups/${state.groupId}/expenses`,
      {
        ocrJobId: job.body.data.id,
        eventId: state.eventId,
        title: 'No debe entrar',
        totalCents: 900,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt: new Date().toISOString(),
        participants: [{ eventParticipantId: state.pAna, shareCents: 900 }],
        payers: [{ eventParticipantId: state.pAna, amountCents: 900 }],
      },
      { 'Idempotency-Key': 'ocr-foreign-key-0001' },
    );
    expect(foreignJob.body.error.code).toBe('OCR_JOB_NOT_FOUND');

    const confirmedAgain = await ana.post(
      `/groups/${state.groupId}/expenses`,
      {
        ocrJobId: job.body.data.id,
        eventId: state.eventId,
        title: 'Repetido',
        totalCents: 900,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt: new Date().toISOString(),
        participants: [{ eventParticipantId: state.pAna, shareCents: 900 }],
        payers: [{ eventParticipantId: state.pAna, amountCents: 900 }],
      },
      { 'Idempotency-Key': 'ocr-repeated-key-0001' },
    );
    expect(confirmedAgain.body.error.code).toBe('OCR_ALREADY_CONFIRMED');

    const otherGroup = await ana.post('/groups', { name: 'Otro grupo OCR', currency: 'USD' });
    const otherUpload = await ana.agent
      .post(`/api/v1/documents?name=otro.png&groupId=${otherGroup.body.data.id}`)
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    const otherJob = await ana.post('/ocr/jobs', { documentId: otherUpload.body.data.id });
    await drain();
    const wrongGroup = await ana.post(
      `/groups/${state.groupId}/expenses`,
      {
        ocrJobId: otherJob.body.data.id,
        eventId: state.eventId,
        title: 'Grupo incorrecto',
        totalCents: 900,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt: new Date().toISOString(),
        participants: [{ eventParticipantId: state.pAna, shareCents: 900 }],
        payers: [{ eventParticipantId: state.pAna, amountCents: 900 }],
      },
      { 'Idempotency-Key': 'ocr-wrong-group-key-0001' },
    );
    expect(wrongGroup.body.error.code).toBe('OCR_DOCUMENT_GROUP_MISMATCH');
  });

  it('Cabudas estima eventos abiertos y consolida deudas liquidadas', async () => {
    const before = await bob.get('/cabudas/summary');
    expect(before.body.data.openEvents).toEqual([
      expect.objectContaining({ eventId: state.eventId, myNetCents: 3000 }),
    ]);
    const settlement = await ana.post(
      `/groups/${state.groupId}/settlements`,
      { eventId: state.eventId },
      { 'Idempotency-Key': 'settle-key-0001' },
    );
    expect(settlement.status).toBe(201);
    state.settlementId = settlement.body.data.id;
    await drain();
    const summary = await bob.get('/cabudas/summary');
    expect(summary.body.data.totals).toEqual([
      { currency: 'USD', owedToMeCents: 0, iOweCents: 3000, netCents: -3000 },
    ]);
    expect(summary.body.data.simplifiedTransfers[0]).toMatchObject({
      direction: 'PAY',
      amountCents: 3000,
      counterparty: { displayName: 'Ana' },
    });
    const anaSummary = await ana.get('/cabudas/summary');
    expect(anaSummary.body.data.totals[0].owedToMeCents).toBe(6000);
    const transferId = summary.body.data.pendingTransfers[0].transferId;
    const paid = await bob.patch(
      `/groups/${state.groupId}/settlements/${state.settlementId}/transfers/${transferId}/paid`,
    );
    expect(paid.status).toBe(200);
    await drain();
    const history = await bob.get('/cabudas/history?status=PAID');
    expect(history.body.data).toHaveLength(1);
    expect((await bob.get('/cabudas/history?status=PAID&status=ALL')).status).toBe(400);
    const anaNotifications = await ana.get('/notifications');
    expect(
      anaNotifications.body.data.some((n: { type: string }) => n.type === 'transfer.paid'),
    ).toBe(true);
    const bobNotifications = await bob.get('/notifications');
    expect(
      bobNotifications.body.data.some((n: { type: string }) => n.type === 'settlement.created'),
    ).toBe(true);
  });

  it('Estadísticas agregan solo datos autorizados', async () => {
    const statsGroup = await ana.post('/groups', {
      name: 'Estadísticas aisladas',
      currency: 'USD',
    });
    expect(statsGroup.status).toBe(201);
    const statsGroupId = statsGroup.body.data.id as string;
    const statsCategory = await ana.post(`/groups/${statsGroupId}/categories`, {
      name: 'Comida',
      color: '#ff8800',
    });
    expect(statsCategory.status).toBe(201);
    const statsEvent = await ana.post(`/groups/${statsGroupId}/events`, {
      name: 'Cena aislada',
      startsAt: new Date().toISOString(),
      memberIds: [],
      guests: [],
    });
    expect(statsEvent.status).toBe(201);
    const statsDetail = await ana.get(`/groups/${statsGroupId}`);
    const statsAnaMember = statsDetail.body.data.members.find(
      (member: { user: { displayName: string } }) => member.user.displayName === 'Ana',
    ).id as string;
    const statsParticipant = (
      statsEvent.body.data.participants as Array<{ id: string; groupMemberId: string | null }>
    ).find((participant) => participant.groupMemberId === statsAnaMember)!.id as string;
    const statsBudget = await ana.post(`/groups/${statsGroupId}/budgets`, {
      name: 'Presupuesto aislado',
      amountCents: 10_000,
      period: 'MONTHLY',
      startsAt: '2026-01-01T00:00:00.000Z',
      categoryId: statsCategory.body.data.id,
      alertThresholdPercent: 50,
    });
    expect(statsBudget.status).toBe(201);
    const occurredAt = new Date().toISOString();
    const firstExpense = await ana.post(
      `/groups/${statsGroupId}/expenses`,
      {
        eventId: statsEvent.body.data.id,
        title: 'Comida categorizada',
        totalCents: 9000,
        currency: 'USD',
        splitMode: 'EXACT',
        categoryId: statsCategory.body.data.id,
        occurredAt,
        participants: [{ eventParticipantId: statsParticipant, shareCents: 9000 }],
        payers: [{ eventParticipantId: statsParticipant, amountCents: 9000 }],
      },
      { 'Idempotency-Key': 'statistics-isolated-expense-0001' },
    );
    expect(firstExpense.status).toBe(201);
    const secondExpense = await ana.post(
      `/groups/${statsGroupId}/expenses`,
      {
        eventId: statsEvent.body.data.id,
        title: 'Comida sin categorizar',
        totalCents: 900,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt,
        participants: [{ eventParticipantId: statsParticipant, shareCents: 900 }],
        payers: [{ eventParticipantId: statsParticipant, amountCents: 900 }],
      },
      { 'Idempotency-Key': 'statistics-isolated-expense-0002' },
    );
    expect(secondExpense.status).toBe(201);
    const stats = await ana.get(`/statistics/summary?groupId=${statsGroupId}`);
    expect(stats.body.data.totals).toMatchObject({
      spentCents: 9900,
      expenseCount: 2,
      // Los dos gastos de este flujo solo incluyen a Ana como participante;
      // myShareCents suma sus partes, mientras myPaidCents suma sus pagos.
      // No se mezclan los 9,900 centavos pagados con una parte de terceros.
      myShareCents: 9900,
      myPaidCents: 9900,
    });
    expect(stats.body.data.byCategory[0]).toMatchObject({ name: 'Comida', totalCents: 9000 });
    expect(stats.body.data.budgets[0]).toMatchObject({
      budgetId: statsBudget.body.data.id,
      spentCents: 9000,
    });
    const csv = await ana.get(`/statistics/summary/export?groupId=${statsGroupId}&currency=USD`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('USD');
    expect(csv.text).toContain('amountCents');
    const carlStats = await carl.get('/statistics/summary');
    expect(carlStats.body.data.totals.spentCents).toBe(0);
    expect((await carl.get(`/statistics/summary?groupId=${statsGroupId}`)).status).toBe(404);
  });

  it('Fondos: saldo derivado, permisos, idempotencia y sin saldo negativo', async () => {
    const fund = await ana.post(`/groups/${state.groupId}/funds`, {
      name: 'Caja común',
      memberIds: [state.bobMember],
    });
    expect(fund.status).toBe(201);
    state.fundId = fund.body.data.id;
    const path = `/groups/${state.groupId}/funds/${state.fundId}`;
    const contribution = { type: 'CONTRIBUTION', amountCents: 5000, description: 'Aporte' };
    const first = await bob.post(`${path}/movements`, contribution, {
      'Idempotency-Key': 'fund-move-0001',
    });
    expect(first.status).toBe(201);
    const replay = await bob.post(`${path}/movements`, contribution, {
      'Idempotency-Key': 'fund-move-0001',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.idempotencyReplayed).toBe(true);
    const conflict = await bob.post(
      `${path}/movements`,
      { ...contribution, amountCents: 1 },
      { 'Idempotency-Key': 'fund-move-0001' },
    );
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const bobWithdraw = await bob.post(
      `${path}/movements`,
      { type: 'WITHDRAWAL', amountCents: 100, description: 'Retiro' },
      { 'Idempotency-Key': 'fund-move-0002' },
    );
    expect(bobWithdraw.status).toBe(403);
    const tooMuch = await ana.post(
      `${path}/movements`,
      { type: 'WITHDRAWAL', amountCents: 6000, description: 'Retiro' },
      { 'Idempotency-Key': 'fund-move-0003' },
    );
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const concurrent = await Promise.all(
      [1, 2, 3].map((n) =>
        ana.post(
          `${path}/movements`,
          { type: 'WITHDRAWAL', amountCents: 2000, description: `Retiro ${n}` },
          { 'Idempotency-Key': `fund-conc-000${n}` },
        ),
      ),
    );
    expect(concurrent.filter((response) => response.status === 201)).toHaveLength(2);
    const detail = await bob.get(path);
    expect(detail.body.data.balanceCents).toBe(1000);
    expect(detail.body.data.canManage).toBe(false);
    expect((await ana.post(`${path}/archive`)).body.error.code).toBe('FUND_BALANCE_NOT_ZERO');
    expect((await carl.get(path)).status).toBe(404);
    const movements = await ana.get(`${path}/movements`);
    expect(movements.body.data).toHaveLength(3);
  });

  it('Docs: subida validada, permisos, URL firmada y bitácora', async () => {
    const upload = await ana.agent
      .post(
        `/api/v1/documents?name=${encodeURIComponent('recibo cena.png')}&groupId=${state.groupId}&eventId=${state.eventId}`,
      )
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(upload.status).toBe(201);
    expect(upload.body.data).not.toHaveProperty('storageKey');
    state.documentId = upload.body.data.id;
    const spoofed = await ana.agent
      .post(`/api/v1/documents?name=x.png&groupId=${state.groupId}`)
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<html>no soy png</html>'));
    expect(spoofed.body.error.code).toBe('CONTENT_MISMATCH');
    const html = await ana.agent
      .post('/api/v1/documents?name=x.html')
      .set('X-CSRF-Token', ana.csrf)
      .set('Content-Type', 'text/html')
      .send('<b>x</b>');
    expect(html.status).toBe(415);
    const foreign = await carl.agent
      .post(`/api/v1/documents?name=x.png&groupId=${state.groupId}`)
      .set('X-CSRF-Token', carl.csrf)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(foreign.status).toBe(404);
    const bobList = await bob.get(`/documents?groupId=${state.groupId}`);
    expect(bobList.body.data[0]).toMatchObject({ id: state.documentId, access: 'VIEW' });
    expect((await bob.delete(`/documents/${state.documentId}`)).status).toBe(403);
    expect((await carl.get(`/documents/${state.documentId}`)).status).toBe(404);
    const signed = await bob.post(`/documents/${state.documentId}/download-url`);
    expect(signed.status).toBe(200);
    const pathOnly = new URL(signed.body.data.url).pathname;
    const download = await bob.agent.get(pathOnly);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((await carl.agent.get(`${pathOnly.slice(0, -3)}abc`)).status).toBe(403);
    const grant = await ana.put(
      `/documents/${state.documentId}/grants/${(await bob.get('/auth/me')).body.data.user.id}`,
      { access: 'EDIT' },
    );
    expect(grant.status).toBe(200);
    expect(
      (await bob.patch(`/documents/${state.documentId}`, { name: 'Recibo final.png' })).body.data
        .name,
    ).toBe('Recibo final.png');
    const carlId = (await carl.get('/auth/me')).body.data.user.id;
    expect(
      (await ana.put(`/documents/${state.documentId}/grants/${carlId}`, { access: 'VIEW' })).body
        .error.code,
    ).toBe('GRANTEE_OUTSIDE_GROUP');
    const logs = await ana.get(`/documents/${state.documentId}/access-logs`);
    expect(logs.body.data.map((log: { action: string }) => log.action)).toEqual(
      expect.arrayContaining(['upload', 'download_url', 'grant:EDIT', 'update']),
    );
  });

  it('OCR: propuesta asíncrona que solo se aplica con confirmación humana', async () => {
    const job = await ana.post('/ocr/jobs', { documentId: state.documentId });
    expect(job.status).toBe(202);
    await drain();
    const done = await ana.get(`/ocr/jobs/${job.body.data.id}`);
    expect(done.body.data).toMatchObject({
      status: 'SUCCEEDED',
      proposal: { merchant: 'Pupusería', totalCents: 9000 },
    });
    const expenseBefore = await ctx.db.expense.findUniqueOrThrow({
      where: { id: state.expenseId! },
    });
    expect(expenseBefore.title).toBe('Pupusas');
    expect((await bob.get(`/ocr/jobs/${job.body.data.id}`)).status).toBe(404);
    const confirmed = await ana.post(`/ocr/jobs/${job.body.data.id}/confirm`, {
      expenseId: state.expenseId,
    });
    expect(confirmed.body.data.confirmedExpenseId).toBe(state.expenseId);
    const document = await ctx.db.document.findUniqueOrThrow({ where: { id: state.documentId! } });
    expect(document.expenseId).toBe(state.expenseId);
    expect((await ana.post(`/ocr/jobs/${job.body.data.id}/retry`)).body.error.code).toBe(
      'OCR_NOT_RETRYABLE',
    );
  });

  it('Logros y avisos: desbloqueo idempotente, contador y preferencias', async () => {
    const achievements = await ana.get('/achievements');
    const byCode = Object.fromEntries(
      achievements.body.data.map((a: { code: string; status: string }) => [a.code, a.status]),
    );
    expect(byCode).toMatchObject({
      FIRST_GROUP: 'UNLOCKED',
      FIRST_EVENT: 'UNLOCKED',
      FIRST_EXPENSE: 'UNLOCKED',
      FIRST_CLOSE: 'UNLOCKED',
      EVENT_PLANNER: 'IN_PROGRESS',
      RELIABLE_PAYER: 'LOCKED',
    });
    await ana.get('/achievements');
    await drain();
    expect(
      await ctx.db.userAchievement.count({ where: { user: { email: 'ana@example.com' } } }),
    ).toBe(4);
    const bobAchievements = await bob.get('/achievements/history');
    expect(bobAchievements.body.data.map((a: { code: string }) => a.code)).toContain('GOOD_PAYER');
    const unread = await ana.get('/notifications/unread-count');
    expect(unread.body.data.unread).toBeGreaterThan(0);
    const first = (await ana.get('/notifications')).body.data[0];
    expect((await ana.post(`/notifications/${first.id}/archive`)).body.data.status).toBe(
      'ARCHIVED',
    );
    expect((await bob.post(`/notifications/${first.id}/read`)).status).toBe(404);
    await ana.post('/notifications/read-all');
    expect((await ana.get('/notifications/unread-count')).body.data.unread).toBe(0);
    const prefs = await ana.put('/notifications/preferences', {
      preferences: [{ type: 'transfer.paid', inApp: false, email: false, push: false }],
    });
    expect(
      prefs.body.data.preferences.find((p: { type: string }) => p.type === 'transfer.paid').inApp,
    ).toBe(false);
    expect(prefs.body.data.channels).toMatchObject({ inApp: true, push: false });
    const pushConfig = await ana.get('/notifications/push-config');
    expect(pushConfig.body.data).toEqual({ enabled: false, publicKey: null });
    const push = await ana.post('/notifications/push-subscriptions', {
      endpoint: 'http://inseguro',
      keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(10) },
    });
    expect(push.status).toBe(400);
  });

  it('Privacidad: exportación sin secretos ni terceros, supresión anonimizada', async () => {
    const access = await bob.post('/privacy/requests', { type: 'ACCESS' });
    expect(access.status).toBe(201);
    expect((await bob.get(`/privacy/requests/${access.body.data.id}/export`)).body.error.code).toBe(
      'EXPORT_NOT_AVAILABLE',
    );
    const confirmed = await bob.post(`/privacy/requests/${access.body.data.id}/confirm`, {});
    expect(confirmed.body.data).toMatchObject({ status: 'COMPLETED', exportAvailable: true });
    const exported = await bob.get(`/privacy/requests/${access.body.data.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('cabales-export-');
    const json = JSON.stringify(exported.body.data);
    expect(exported.body.data.profile.email).toBe('bob@example.com');
    expect(exported.body.data.expenses[0]).toMatchObject({
      myShareCents: 3000,
      createdByMe: false,
    });
    for (const forbidden of [
      'passwordHash',
      'tokenHash',
      'csrfTokenHash',
      'ana@example.com',
      'ipAddress',
      'userAgent',
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect((await ana.get(`/privacy/requests/${access.body.data.id}`)).status).toBe(404);
    await bob.post('/privacy/requests', { type: 'RECTIFICATION', reason: 'Corregir nombre' });
    expect((await bob.post('/privacy/requests', { type: 'RECTIFICATION' })).body.error.code).toBe(
      'PRIVACY_REQUEST_OPEN',
    );

    const erasure = await bob.post('/privacy/requests', { type: 'ERASURE' });
    const id = erasure.body.data.id;
    expect((await bob.post(`/privacy/requests/${id}/confirm`, {})).body.error.code).toBe(
      'REAUTH_REQUIRED',
    );
    expect(
      (await bob.post(`/privacy/requests/${id}/confirm`, { password: 'incorrecta-123456' })).body
        .error.code,
    ).toBe('REAUTH_FAILED');
    const erased = await bob.post(`/privacy/requests/${id}/confirm`, {
      password: 'una-clave-segura-123',
    });
    expect(erased.body.data.status).toBe('COMPLETED');
    await drain();
    expect((await bob.get('/auth/me')).status).toBe(401);
    expect((await new Client(ctx.app).login('bob@example.com')).status).toBe(401);
    const row = await ctx.db.user.findFirstOrThrow({ where: { displayName: 'Usuario eliminado' } });
    expect(row).toMatchObject({ isActive: false, avatarUrl: null });
    expect(row.email).toMatch(/@anon\.cabales\.invalid$/);
    expect(await ctx.db.account.count({ where: { userId: row.id } })).toBe(0);
    expect(await ctx.db.session.count({ where: { userId: row.id } })).toBe(0);
    const history = await ana.get('/cabudas/history');
    expect(
      history.body.data.some(
        (t: { counterparty: { displayName: string } }) =>
          t.counterparty.displayName === 'Usuario eliminado',
      ),
    ).toBe(true);
    expect((await ana.get(`/groups/${state.groupId}/expenses/${state.expenseId}`)).status).toBe(
      200,
    );
  });

  it('Recuperación de contraseña: un solo uso, revoca sesiones', async () => {
    await ana.agent
      .post('/api/v1/auth/password-recovery/request')
      .send({ email: 'ana@example.com' });
    await ana.agent
      .post('/api/v1/auth/password-recovery/request')
      .send({ email: 'nadie@example.com' });
    await drain();
    expect(ctx.capture.sent.some((message) => message.to === 'nadie@example.com')).toBe(false);
    const token = ctx.capture.lastTokenFor('ana@example.com', 'Recupera');
    const other = new Client(ctx.app);
    await other.login('ana@example.com');
    const reset = await other.agent
      .post('/api/v1/auth/password-recovery/confirm')
      .send({ token, password: 'otra-clave-segura-456' });
    expect(reset.status).toBe(200);
    expect((await ana.get('/auth/me')).status).toBe(401);
    expect(
      (
        await other.agent
          .post('/api/v1/auth/password-recovery/confirm')
          .send({ token, password: 'otra-clave-segura-789' })
      ).status,
    ).toBe(400);
    expect(
      (await new Client(ctx.app).login('ana@example.com', 'otra-clave-segura-456')).status,
    ).toBe(200);
  });

  it('Retención: dry-run cuenta, ejecución purga y audita', async () => {
    await ctx.db.session.updateMany({ data: { expiresAt: new Date('2020-01-01T00:00:00Z') } });
    const retention = new RetentionService(ctx.db, ctx.config.retention);
    const dry = await retention.run({ trigger: 'MANUAL', dryRun: true });
    expect(dry.counts.sessions).toBeGreaterThan(0);
    expect(await ctx.db.session.count()).toBeGreaterThan(0);
    const run = await retention.run({ trigger: 'SCHEDULED', dryRun: false });
    expect(run.counts.sessions).toBe(dry.counts.sessions);
    expect(
      await ctx.db.session.count({ where: { expiresAt: { lt: new Date('2021-01-01') } } }),
    ).toBe(0);
    const stored = await ctx.db.retentionRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(stored.status).toBe('SUCCEEDED');
    expect(
      await ctx.db.auditLog.count({ where: { action: 'retention.run', entityId: run.runId } }),
    ).toBe(1);
  });
});
