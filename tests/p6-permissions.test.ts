import { FundRole, GroupRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AchievementsService } from '../src/modules/achievements/achievements.service.js';
import { FundsService } from '../src/modules/funds/funds.service.js';

const groupId = '10000000-0000-4000-8000-000000000001';
const fundId = '20000000-0000-4000-8000-000000000002';
const userId = '30000000-0000-4000-8000-000000000003';
const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('permisos y privacidad de P6', () => {
  it('solo permite crear solicitudes para miembros existentes del fondo', async () => {
    const repository = {
      find: vi.fn(async () => ({ id: fundId, groupId, archivedAt: null })),
      fundMember: vi.fn(async () => ({ id: 'fund-member', role: FundRole.MANAGER })),
      fundMembers: vi.fn(async () => []),
    };
    const groups = {
      requireRole: vi.fn(async () => ({
        id: 'group-member',
        groupId,
        userId,
        role: GroupRole.MEMBER,
      })),
    };
    const service = new FundsService(repository as never, groups as never);

    await expect(
      service.createContributionRequest(
        userId,
        groupId,
        fundId,
        {
          dueAt,
          members: [{ fundMemberId: 'outside-fund-member', amountCents: 1000 }],
        },
        'request-id',
      ),
    ).rejects.toMatchObject({ code: 'FUND_MEMBER_NOT_FOUND' });
  });

  it('rechaza solicitudes a quien no administra el fondo', async () => {
    const repository = {
      find: vi.fn(async () => ({ id: fundId, groupId, archivedAt: null })),
      fundMember: vi.fn(async () => ({ id: 'fund-member', role: FundRole.MEMBER })),
    };
    const groups = {
      requireRole: vi.fn(async () => ({
        id: 'group-member',
        groupId,
        userId,
        role: GroupRole.MEMBER,
      })),
    };
    const service = new FundsService(repository as never, groups as never);

    await expect(
      service.createContributionRequest(
        userId,
        groupId,
        fundId,
        {
          dueAt,
          members: [{ fundMemberId: 'fund-member', amountCents: 1000 }],
        },
        'request-id',
      ),
    ).rejects.toMatchObject({ code: 'FUND_FORBIDDEN' });
  });

  it('no permite consultar el ranking desde fuera del grupo y oculta opt-out', async () => {
    const visibleUser = '40000000-0000-4000-8000-000000000004';
    const hiddenUser = '50000000-0000-4000-8000-000000000005';
    const groupMember = vi.fn(async (args: { where: Record<string, unknown> }) => {
      if (args.where.groupId === groupId)
        return [
          {
            userId: visibleUser,
            user: {
              id: visibleUser,
              displayName: 'Visible',
              avatarUrl: null,
              achievementRankingVisible: true,
            },
          },
          {
            userId: hiddenUser,
            user: {
              id: hiddenUser,
              displayName: 'Oculto',
              avatarUrl: null,
              achievementRankingVisible: false,
            },
          },
        ];
      return args.where.userId === userId
        ? [{ id: 'viewer-membership', groupId }]
        : [{ id: 'member', groupId }];
    });
    const db = {
      groupMember: {
        findUnique: vi.fn(
          async ({ where }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
            where.groupId_userId.groupId === groupId && where.groupId_userId.userId === userId
              ? { id: 'viewer-membership' }
              : null,
        ),
        findMany: groupMember,
      },
      settlementTransfer: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      group: { count: vi.fn(async () => 0) },
      event: { count: vi.fn(async () => 0) },
      expense: { count: vi.fn(async () => 0) },
      settlement: { count: vi.fn(async () => 0) },
      groupInvitation: { count: vi.fn(async () => 0) },
      fundMovement: { count: vi.fn(async () => 0) },
      eventParticipant: { count: vi.fn(async () => 0) },
    };
    const service = new AchievementsService(db as never);

    await expect(service.ranking('outside-user', groupId)).resolves.toBeNull();
    await expect(service.ranking(userId, groupId)).resolves.toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: visibleUser }) }),
    ]);
  });
});
