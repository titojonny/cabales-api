import { describe, expect, it, vi } from 'vitest';
import { FundContributionRemindersService } from '../src/modules/funds/fund-contribution-reminders.service.js';
import type { FundsRepository } from '../src/modules/funds/funds.repository.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';

const ids = {
  member: '10000000-0000-4000-8000-000000000001',
  request: '20000000-0000-4000-8000-000000000002',
  requestMember: '30000000-0000-4000-8000-000000000003',
  fund: '40000000-0000-4000-8000-000000000004',
  group: '50000000-0000-4000-8000-000000000005',
};

const item = (status: 'PENDING' | 'OVERDUE') => ({
  id: ids.requestMember,
  amountCents: 1250,
  status,
  request: {
    id: ids.request,
    dueAt: new Date('2026-10-04T12:00:00.000Z'),
    fund: { id: ids.fund, groupId: ids.group, name: 'Viaje', currency: 'USD' },
  },
  fundMember: { groupMember: { userId: ids.member } },
});

describe('FundContributionRemindersService', () => {
  it('emite claves separadas para vencimiento y sobrepasa la deduplicacion persistente', async () => {
    const notify = vi.fn(async () => 1);
    const repository = {
      contributionMembersDueBetween: vi.fn(async () => [item('PENDING')]),
      markOverdue: vi.fn(async () => ({ count: 0 })),
      contributionMembersOverdue: vi.fn(async () => [item('OVERDUE')]),
    } as unknown as FundsRepository;
    const service = new FundContributionRemindersService(repository, {
      notify,
    } as unknown as NotificationsService);

    await service.run(new Date('2026-10-03T12:00:00.000Z'));
    await service.run(new Date('2026-10-03T12:01:00.000Z'));

    expect(notify).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'fund.contribution_due',
        dedupeKey: `fund.contribution_due:${ids.requestMember}`,
      }),
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'fund.contribution_overdue',
        dedupeKey: `fund.contribution_overdue:${ids.requestMember}`,
      }),
    );
    expect(
      new Set(
        notify.mock.calls.map((call) => {
          const args: unknown[] = call;
          return (args[0] as { dedupeKey?: string } | undefined)?.dedupeKey;
        }),
      ),
    ).toHaveLength(2);
  });
});
