import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestContainer, resetDatabase, TEST_DATABASE_URL } from './harness.js';

describe.skipIf(!TEST_DATABASE_URL)('Integración P3 de eventos', () => {
  let ctx: Awaited<ReturnType<typeof createTestContainer>>;
  let ana: Client;
  let bob: Client;
  let groupId: string;
  let anaMemberId: string;
  let bobMemberId: string;
  let eventId: string;
  let anaParticipantId: string;
  let bobParticipantId: string;

  beforeAll(async () => {
    ctx = await createTestContainer({ SCHEDULER_ENABLED: 'false' });
    await resetDatabase(ctx.db);
    ana = new Client(ctx.app);
    bob = new Client(ctx.app);
    expect((await ana.register('ana-p3@example.com', 'Ana P3')).status).toBe(201);
    expect((await bob.register('bob-p3@example.com', 'Bob P3')).status).toBe(201);
    const group = await ana.post('/groups', { name: 'Grupo P3', currency: 'USD' });
    groupId = group.body.data.id;
    const invite = await ana.post(`/groups/${groupId}/invitations`, {
      email: 'bob-p3@example.com',
    });
    await ctx.background.drain();
    const token = ctx.capture.lastTokenFor('bob-p3@example.com', 'invitó');
    expect(token).toBeTruthy();
    expect((await bob.post('/groups/invitations/accept', { token })).status).toBe(200);
    const detail = await ana.get(`/groups/${groupId}`);
    anaMemberId =
      detail.body.data.members.find(
        (member: { user: { email?: string } }) => member.user?.email === 'ana-p3@example.com',
      )?.id ?? detail.body.data.members[0].id;
    bobMemberId =
      detail.body.data.members.find(
        (member: { user: { email?: string } }) => member.user?.email === 'bob-p3@example.com',
      )?.id ?? detail.body.data.members[1].id;
    expect(invite.status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.scheduler.stop();
    await ctx?.background.drain();
    await ctx?.db.$disconnect();
  });

  it('cubre permisos, RSVP propio, edición, borrado bloqueado y recordatorios idempotentes', async () => {
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const event = await ana.post(`/groups/${groupId}/events`, {
      name: 'Evento P3',
      description: 'Plan real',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
      locationName: 'Lugar real',
      locationAddress: 'Dirección real',
      mapsUrl: 'https://maps.google.com/?q=Cabales',
      timeZone: 'America/El_Salvador',
      memberIds: [bobMemberId],
      guests: [],
      links: [{ label: 'Mapa', url: 'https://maps.google.com/?q=Cabales' }],
    });
    expect(event.status).toBe(201);
    eventId = event.body.data.id;
    anaParticipantId = event.body.data.participants.find(
      (participant: { groupMemberId: string }) => participant.groupMemberId === anaMemberId,
    ).id;
    bobParticipantId = event.body.data.participants.find(
      (participant: { groupMemberId: string }) => participant.groupMemberId === bobMemberId,
    ).id;

    expect(
      (await bob.patch(`/groups/${groupId}/events/${eventId}`, { name: 'No autorizado' })).status,
    ).toBe(403);
    expect(
      (await ana.patch(`/groups/${groupId}/events/${eventId}`, { name: 'Evento editado' })).status,
    ).toBe(200);
    expect(
      (
        await bob.put(`/groups/${groupId}/events/${eventId}/rsvp`, {
          status: 'GOING',
          participantId: anaParticipantId,
        })
      ).status,
    ).toBe(400);
    expect(
      (await bob.put(`/groups/${groupId}/events/${eventId}/rsvp`, { status: 'DECLINED' })).status,
    ).toBe(200);
    const afterRsvp = await ana.get(`/groups/${groupId}/events/${eventId}`);
    expect(
      afterRsvp.body.data.participants.find(
        (participant: { id: string }) => participant.id === bobParticipantId,
      ).rsvpStatus,
    ).toBe('DECLINED');

    expect(
      (
        await ana.put(`/groups/${groupId}/events/${eventId}/reminders`, {
          reminders: [{ minutesBefore: 60 }],
        })
      ).status,
    ).toBe(200);
    const reminderNow = new Date(startsAt.getTime() - 59 * 60_000);
    await ctx.scheduler.runNow('event-reminders', reminderNow);
    await ctx.scheduler.runNow('event-reminders', reminderNow);
    const anaNotifications = await ana.get('/notifications?status=ACTIVE&limit=100');
    expect(
      anaNotifications.body.data.filter(
        (notification: { type: string }) => notification.type === 'event.reminder',
      ),
    ).toHaveLength(1);
    const bobNotifications = await bob.get('/notifications?status=ACTIVE&limit=100');
    expect(
      bobNotifications.body.data.some(
        (notification: { type: string }) => notification.type === 'event.reminder',
      ),
    ).toBe(false);

    const expense = await ana.post(
      `/groups/${groupId}/expenses`,
      {
        eventId,
        title: 'Gasto P3',
        totalCents: 100,
        currency: 'USD',
        splitMode: 'EXACT',
        occurredAt: startsAt.toISOString(),
        participants: [{ eventParticipantId: anaParticipantId, shareCents: 100 }],
        payers: [{ eventParticipantId: anaParticipantId, amountCents: 100 }],
      },
      { 'Idempotency-Key': 'p3-event-expense-0001' },
    );
    expect(expense.status).toBe(201);
    const blocked = await ana.delete(`/groups/${groupId}/events/${eventId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EVENT_HAS_FINANCIAL_ACTIVITY');
  });
});
