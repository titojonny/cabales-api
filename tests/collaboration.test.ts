import { FundAccessPolicy, FundRole, GroupRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/database/client.js';
import {
  commentSchema,
  createShareLinkSchema,
  eventFundsSchema,
} from '../src/modules/collaboration/collaboration.schema.js';
import { CollaborationService } from '../src/modules/collaboration/collaboration.service.js';
import { FundsService } from '../src/modules/funds/funds.service.js';

const token = 'A'.repeat(43);
const groupId = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';

function serviceWith(db: unknown, role: GroupRole = GroupRole.MEMBER) {
  return new CollaborationService(db as Database, {
    requireRole: async () => ({ id: '00000000-0000-4000-8000-000000000004', role }),
  });
}

describe('P8 colaboración', () => {
  it('exige un único objetivo para enlaces públicos y limita su vigencia', () => {
    expect(
      createShareLinkSchema.safeParse({
        eventId: '00000000-0000-4000-8000-000000000001',
        settlementId: '00000000-0000-4000-8000-000000000002',
        expiresInDays: 31,
      }).success,
    ).toBe(false);
    expect(
      createShareLinkSchema.safeParse({
        eventId: '00000000-0000-4000-8000-000000000001',
        expiresInDays: 30,
      }).success,
    ).toBe(true);
  });

  it('rechaza HTML y duplicados en contratos de colaboración', () => {
    expect(commentSchema.safeParse({ body: '<script>alert(1)</script>' }).success).toBe(false);
    expect(
      eventFundsSchema.safeParse({
        fundIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'],
      }).success,
    ).toBe(false);
  });

  it('conserva la semántica de permisos de fondos', () => {
    expect(
      CollaborationService.policyAllows(FundAccessPolicy.ANY_MEMBER, GroupRole.MEMBER, 'MEMBER'),
    ).toBe(true);
    expect(
      CollaborationService.policyAllows(FundAccessPolicy.ANY_MEMBER, GroupRole.MEMBER, null),
    ).toBe(false);
    expect(
      CollaborationService.policyAllows(FundAccessPolicy.ANY_MEMBER, GroupRole.ADMIN, null),
    ).toBe(false);
    expect(
      CollaborationService.policyAllows(FundAccessPolicy.MANAGERS, GroupRole.MEMBER, 'MANAGER'),
    ).toBe(true);
    expect(
      CollaborationService.policyAllows(FundAccessPolicy.GROUP_ADMINS, GroupRole.ADMIN, null),
    ).toBe(true);
  });

  it('solo publica nombres y totales, nunca ids internos ni correos', async () => {
    const db = {
      publicShareLink: {
        findFirst: async () => ({
          id: '00000000-0000-4000-8000-000000000005',
          groupId,
          expiresAt: new Date(Date.now() + 60_000),
          eventId,
          settlementId: null,
          group: { name: 'Viaje' },
        }),
      },
      event: {
        findFirst: async () => ({
          id: eventId,
          name: 'Cena',
          status: 'OPEN',
          groupId,
          group: { currency: 'USD' },
          expenses: [{ totalCents: 1200, currency: 'USD' }],
          settlement: null,
          participants: [
            { id: 'internal-id', guestName: null, groupMember: { user: { displayName: 'Ana' } } },
          ],
        }),
      },
    };
    const result = await serviceWith(db).publicSummary(token);
    expect(result).toMatchObject({ groupName: 'Viaje', eventName: 'Cena', totalCents: 1200 });
    expect(result).not.toHaveProperty('eventId');
    expect(JSON.stringify(result)).not.toContain('email');
    expect(JSON.stringify(result)).not.toContain('internal-id');
  });

  it('rechaza enlaces caducados o revocados por la consulta de hash y estado', async () => {
    let query:
      { where?: { tokenHash?: string; revokedAt?: null; expiresAt?: { gt: Date } } } | undefined;
    const findFirst = async (args: typeof query) => {
      query = args;
      return null;
    };
    await expect(
      serviceWith({ publicShareLink: { findFirst } }).publicSummary(token),
    ).rejects.toMatchObject({
      code: 'SHARE_LINK_NOT_FOUND',
      status: 404,
    });
    expect(query?.where?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(query?.where?.tokenHash).not.toBe(token);
    expect(query?.where?.revokedAt).toBeNull();
    expect(query?.where?.expiresAt?.gt).toBeInstanceOf(Date);
  });

  it('aplica permisos propios o de moderacion al editar comentarios', async () => {
    const db = {
      eventComment: {
        findFirst: async () => ({
          id: '00000000-0000-4000-8000-000000000006',
          authorUserId: userId,
        }),
      },
    };
    await expect(
      serviceWith(db).updateComment(
        '00000000-0000-4000-8000-000000000007',
        groupId,
        eventId,
        '00000000-0000-4000-8000-000000000006',
        { body: 'nuevo' },
      ),
    ).rejects.toMatchObject({ code: 'COMMENT_FORBIDDEN', status: 403 });
  });

  it('evita IDOR al repetir un gasto fuera del grupo solicitado', async () => {
    const requireRole = async () => ({
      id: '00000000-0000-4000-8000-000000000004',
      role: GroupRole.MEMBER,
    });
    const findFirst = async (args: { where: { groupId: string } }) => {
      expect(args.where.groupId).toBe(groupId);
      return null;
    };
    const service = new CollaborationService({ expense: { findFirst } } as unknown as Database, {
      requireRole,
    });
    await expect(service.repeatExpense(userId, groupId, eventId)).rejects.toMatchObject({
      code: 'EXPENSE_NOT_FOUND',
      status: 404,
    });
  });

  it('aplica en servidor la politica y el limite de retiros del fondo', async () => {
    const groups = {
      requireRole: async () => ({
        id: '00000000-0000-4000-8000-000000000004',
        role: GroupRole.MEMBER,
      }),
    };
    const baseFund = {
      archivedAt: null,
      contributionPolicy: FundAccessPolicy.ANY_MEMBER,
      withdrawalPolicy: FundAccessPolicy.GROUP_ADMINS,
      closingPolicy: FundAccessPolicy.MANAGERS,
      withdrawalLimitCents: 100,
    };
    const repository = {
      find: async () => baseFund,
      fundMember: async () => ({
        id: '00000000-0000-4000-8000-000000000005',
        role: FundRole.MEMBER,
      }),
      createMovementAtomic: async () => {
        throw new Error('no debe registrar el movimiento');
      },
    };
    const service = new FundsService(repository as never, groups as never);
    await expect(
      service.createMovement(
        userId,
        groupId,
        eventId,
        { type: 'WITHDRAWAL', amountCents: 50, description: 'Retiro de prueba' },
        'p8-key-policy',
        'p8-request-policy',
      ),
    ).rejects.toMatchObject({ code: 'FUND_FORBIDDEN', status: 403 });

    const managerRepository = {
      ...repository,
      find: async () => ({ ...baseFund, withdrawalPolicy: FundAccessPolicy.MANAGERS }),
      fundMember: async () => ({
        id: '00000000-0000-4000-8000-000000000005',
        role: FundRole.MANAGER,
      }),
    };
    const managerService = new FundsService(managerRepository as never, groups as never);
    await expect(
      managerService.createMovement(
        userId,
        groupId,
        eventId,
        { type: 'WITHDRAWAL', amountCents: 101, description: 'Retiro excedido' },
        'p8-key-limit',
        'p8-request-limit',
      ),
    ).rejects.toMatchObject({ code: 'WITHDRAWAL_LIMIT_EXCEEDED', status: 422 });
  });
});
