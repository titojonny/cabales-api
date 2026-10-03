import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestContainer, resetDatabase, TEST_DATABASE_URL } from './harness.js';

describe.skipIf(!TEST_DATABASE_URL)('P4 integración: aislamiento y recurrencias', () => {
  let ctx: Awaited<ReturnType<typeof createTestContainer>>;
  let ana: Client;
  let bob: Client;
  let recurringId = '';

  beforeAll(async () => {
    ctx = await createTestContainer();
    await resetDatabase(ctx.db);
    ana = new Client(ctx.app);
    bob = new Client(ctx.app);
    expect((await ana.register('p4-ana@example.com', 'Ana P4')).status).toBe(201);
    expect((await bob.register('p4-bob@example.com', 'Bob P4')).status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.db.$disconnect();
  });

  it('aísla gastos personales entre usuarios y permite editar solo al propietario', async () => {
    const created = await ana.post(
      '/expenses',
      {
        title: 'Gasto privado P4',
        totalCents: 1250,
        currency: 'USD',
        occurredAt: '2026-10-01T12:00:00.000Z',
        tagIds: [],
      },
      { 'Idempotency-Key': 'p4-personal-expense-01' },
    );
    expect(created.status).toBe(201);
    const expenseId = created.body.data.id as string;
    expect((await bob.get('/expenses?scope=PERSONAL&month=2026-10')).body.data).toEqual([]);
    expect((await bob.get(`/expenses/${expenseId}`)).status).toBe(404);
    expect((await bob.patch(`/expenses/${expenseId}`, { title: 'IDOR' })).status).toBe(404);
    expect(
      (await ana.patch(`/expenses/${expenseId}`, { title: 'Gasto privado editado' })).status,
    ).toBe(200);
  });

  it('registra un solo gasto aunque se ejecute dos veces el job recurrente', async () => {
    const created = await ana.post('/recurring-expenses', {
      title: 'Suscripción P4',
      amountCents: 999,
      currency: 'USD',
      frequency: 'MONTHLY',
      chargeDay: 1,
      nextRunAt: '2026-09-01T08:00:00.000Z',
      tagIds: [],
    });
    expect(created.status).toBe(201);
    recurringId = created.body.data.id as string;
    await ctx.scheduler.runNow('recurring-expenses', new Date('2026-10-03T08:00:00.000Z'));
    await ctx.scheduler.runNow('recurring-expenses', new Date('2026-10-03T08:00:00.000Z'));
    expect(await ctx.db.expense.count({ where: { recurringExpenseId: recurringId } })).toBe(1);
    expect((await ana.get('/expenses?scope=PERSONAL&month=2026-09')).body.meta.total).toBe(999);
  });
});
