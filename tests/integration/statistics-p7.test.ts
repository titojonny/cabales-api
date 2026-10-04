import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestContainer, resetDatabase, TEST_DATABASE_URL } from './harness.js';

describe.skipIf(!TEST_DATABASE_URL)('Integración P7: estadísticas e ingresos', () => {
  let ctx: Awaited<ReturnType<typeof createTestContainer>>;
  let ana: Client;
  let bob: Client;
  let groupId: string;

  beforeAll(async () => {
    ctx = await createTestContainer();
    await resetDatabase(ctx.db);
    ana = new Client(ctx.app);
    bob = new Client(ctx.app);
    expect((await ana.register('p7-ana@example.com', 'Ana P7')).status).toBe(201);
    expect((await bob.register('p7-bob@example.com', 'Bob P7')).status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.db.$disconnect();
  });

  it('mantiene ingresos por usuario y evita exponer los de otra cuenta', async () => {
    const created = await ana.post('/incomes', {
      amountCents: 250000,
      date: '2026-10-01T12:00:00.000Z',
      category: 'Salario',
      note: 'P7',
      currency: 'USD',
    });
    expect(created.status).toBe(201);
    expect((await ana.get('/incomes?currency=USD')).body.data).toHaveLength(1);
    expect((await bob.get('/incomes?currency=USD')).body.data).toHaveLength(0);
  });

  it('devuelve comparación, proyección de recurrentes pendientes y PDF válido', async () => {
    const group = await ana.post('/groups', { name: 'P7 estadísticas', currency: 'USD' });
    expect(group.status).toBe(201);
    groupId = group.body.data.id;
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await ctx.db.recurringExpense.create({
      data: {
        groupId,
        title: 'Servidor',
        amountCents: 1200,
        currency: 'USD',
        frequency: 'MONTHLY',
        nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        isActive: true,
      },
    });
    const summary = await ana.get(`/statistics/summary?groupId=${groupId}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.comparison.total).toMatchObject({
      currentCents: 0,
      previousCents: 0,
      absoluteCents: 0,
      percentage: null,
    });
    expect(summary.body.data.projection.recurrentPendingCents).toBe(1200);
    expect(summary.body.data.projection.recurrentPending).toHaveLength(1);
    expect(new Date(summary.body.data.projection.asOf).getTime()).toBeGreaterThan(0);
    expect(nextMonth.getTime()).toBeGreaterThan(
      new Date(summary.body.data.projection.asOf).getTime(),
    );

    const pdf = await ana.get(`/statistics/summary/export/pdf?groupId=${groupId}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 8).toString('ascii')).toContain('%PDF-1.4');
    expect((await new Client(ctx.app).get('/statistics/summary')).status).toBe(401);
  });
});
