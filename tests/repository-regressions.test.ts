import { DocumentAccessLevel, FundMovementType, FundRole, GroupRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FundsRepository } from '../src/modules/funds/funds.repository.js';
import { FundsService } from '../src/modules/funds/funds.service.js';
import { GroupsRepository } from '../src/modules/groups/groups.repository.js';
import { PrivacyRepository } from '../src/modules/privacy/privacy.repository.js';
import { AppError } from '../src/shared/errors.js';
import { DocumentsService } from '../src/modules/documents/documents.service.js';

const groupId = '10000000-0000-4000-8000-000000000001';
const fundId = '20000000-0000-4000-8000-000000000001';

function transactionDb(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  };
}

function groupDeleteDb(counts: Record<string, number>) {
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: groupId }]),
    groupMember: { count: vi.fn(async () => counts.members ?? 0) },
    groupInvitation: { count: vi.fn(async () => counts.invitations ?? 0) },
    event: { count: vi.fn(async () => counts.events ?? 0) },
    expense: { count: vi.fn(async () => counts.expenses ?? 0) },
    settlement: { count: vi.fn(async () => counts.settlements ?? 0) },
    fund: { count: vi.fn(async () => counts.funds ?? 0) },
    budget: { count: vi.fn(async () => counts.budgets ?? 0) },
    recurringExpense: { count: vi.fn(async () => counts.recurring ?? 0) },
    document: { count: vi.fn(async () => counts.documents ?? 0) },
    category: { count: vi.fn(async () => counts.categories ?? 0) },
    tag: { count: vi.fn(async () => counts.tags ?? 0) },
    group: { delete: vi.fn(async () => undefined) },
  };
  return { db: transactionDb(tx), tx };
}

describe('regresiones de eliminacion y fondos', () => {
  it('invalida las concesiones de un documento cuando el usuario sale del grupo', async () => {
    const grantFor = vi.fn(async () => ({ access: DocumentAccessLevel.EDIT }));
    const repository = { grantFor };
    const groups = {
      requireRole: vi.fn(async () => {
        throw new AppError(404, 'GROUP_NOT_FOUND', 'not a member');
      }),
    };
    const service = new DocumentsService(repository as never, groups as never, {} as never, {
      maxBytes: 1024,
      signedUrlTtlSeconds: 300,
    });

    await expect(
      service.accessLevel('user-outside-group', {
        id: '50000000-0000-4000-8000-000000000001',
        ownerId: 'owner-id',
        groupId,
      }),
    ).resolves.toBeNull();
    expect(grantFor).not.toHaveBeenCalled();
  });

  it('no convierte un fallo de membresia en acceso por concesion', async () => {
    const repository = { grantFor: vi.fn(async () => ({ access: DocumentAccessLevel.EDIT })) };
    const groups = { requireRole: vi.fn(async () => Promise.reject(new Error('database down'))) };
    const service = new DocumentsService(repository as never, groups as never, {} as never, {
      maxBytes: 1024,
      signedUrlTtlSeconds: 300,
    });

    await expect(
      service.accessLevel('user-id', { id: 'document-id', ownerId: 'owner-id', groupId }),
    ).rejects.toThrow('database down');
    expect(repository.grantFor).not.toHaveBeenCalled();
  });

  it('no expone la clave interna de almacenamiento en la respuesta del documento', async () => {
    const repository = {
      grantFor: vi.fn(async () => null),
      find: vi.fn(async () => ({
        id: '50000000-0000-4000-8000-000000000002',
        name: 'recibo.png',
        mimeType: 'image/png',
        sizeBytes: 12,
        groupId: null,
        eventId: null,
        expenseId: null,
        settlementId: null,
        ownerId: 'owner-id',
        owner: { id: 'owner-id', displayName: 'Owner' },
        createdAt: new Date(),
        updatedAt: new Date(),
        storageKey: 'documents/2026-09/50000000-0000-4000-8000-000000000002',
      })),
    };
    const service = new DocumentsService(repository as never, {} as never, {} as never, {
      maxBytes: 1024,
      signedUrlTtlSeconds: 300,
    });

    const result = await service.detail('owner-id', '50000000-0000-4000-8000-000000000002');
    expect(result).not.toHaveProperty('storageKey');
  });

  it.each([
    ['miembros adicionales', { members: 2 }],
    ['fondos', { funds: 1 }],
    ['presupuestos', { budgets: 1 }],
    ['documentos', { documents: 1 }],
  ])('no borra un grupo con %s', async (_description, counts) => {
    const { db, tx } = groupDeleteDb(counts);
    const result = await new GroupsRepository(db as never).deleteEmptyAtomic(groupId);
    expect(result).toBe('NOT_EMPTY');
    expect(tx.group.delete).not.toHaveBeenCalled();
  });

  function privacyEraseDb(counts: Record<string, number>) {
    const model = () => ({
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    });
    const tx = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({ email: 'owner@example.com' })),
        update: vi.fn(async () => undefined),
      },
      groupMember: {
        findMany: vi.fn(async () => [{ groupId }]),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
      },
      groupInvitation: { ...model(), count: vi.fn(async () => counts.invitations ?? 0) },
      event: { ...model(), count: vi.fn(async () => counts.events ?? 0) },
      expense: { ...model(), count: vi.fn(async () => counts.expenses ?? 0) },
      settlement: { ...model(), count: vi.fn(async () => counts.settlements ?? 0) },
      fund: { ...model(), count: vi.fn(async () => counts.funds ?? 0) },
      budget: { ...model(), count: vi.fn(async () => counts.budgets ?? 0) },
      recurringExpense: { ...model(), count: vi.fn(async () => counts.recurring ?? 0) },
      document: {
        ...model(),
        count: vi.fn(async () => counts.documents ?? 0),
        findMany: vi.fn(async () => []),
      },
      group: { delete: vi.fn(async () => undefined) },
      tag: model(),
      category: model(),
      account: model(),
      session: model(),
      emailVerificationToken: model(),
      passwordResetToken: model(),
      pushSubscription: model(),
      notification: model(),
      notificationPreference: model(),
      idempotencyKey: model(),
      documentAccessGrant: model(),
      userAchievement: model(),
      privacyRequest: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async () => undefined),
      },
      auditLog: { create: vi.fn(async () => undefined) },
    };
    return { db: transactionDb(tx), tx };
  }

  it.each([
    ['fondos', { funds: 1 }],
    ['presupuestos', { budgets: 1 }],
    ['documentos', { documents: 1 }],
  ])('la supresion de cuenta conserva un grupo con %s', async (_description, counts) => {
    const { db, tx } = privacyEraseDb(counts);
    const result = await new PrivacyRepository(db as never).eraseUser(
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'request-id',
    );
    expect(result.summary.deletedGroups).toBe(0);
    expect(tx.group.delete).not.toHaveBeenCalled();
  });

  it('usa una transaccion bloqueada para archivar y rechaza movimientos posteriores', async () => {
    let archivedAt: Date | null = null;
    const tx = {
      $queryRaw: vi.fn(async () => [{ archivedAt }]),
      fundMovement: {
        aggregate: vi.fn(async () => ({ _sum: { amountCents: 0 } })),
        create: vi.fn(async () => undefined),
      },
      fund: {
        update: vi.fn(async () => {
          archivedAt = new Date();
          return { id: fundId, archivedAt };
        }),
      },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => undefined),
      },
      auditLog: { create: vi.fn(async () => undefined) },
    };
    const repository = new FundsRepository(transactionDb(tx) as never);
    const archived = await repository.archiveAtomic(fundId);
    expect(archived.outcome).toBe('ARCHIVED');
    const movement = await repository.createMovementAtomic({
      fundId,
      userId: '30000000-0000-4000-8000-000000000001',
      type: FundMovementType.CONTRIBUTION,
      signedAmountCents: 100,
      key: 'key',
      requestHash: 'hash',
      requestId: 'request-id',
    });
    expect(movement.outcome).toBe('ARCHIVED');
    expect(tx.fundMovement.create).not.toHaveBeenCalled();
  });

  it('no deja un fondo sin gestores al degradar o retirar al ultimo', async () => {
    const update = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: fundId }]),
      fundMember: {
        findFirst: vi.fn(async () => ({
          id: 'member-id',
          role: FundRole.MANAGER,
          groupMemberId: 'group-member-id',
        })),
        count: vi.fn(async () => 1),
        update,
        delete: remove,
      },
    };
    const repository = new FundsRepository(transactionDb(tx) as never);
    expect(
      (await repository.updateMemberAtomic(fundId, 'member-id', FundRole.MEMBER)).outcome,
    ).toBe('LAST_MANAGER');
    expect((await repository.removeMemberAtomic(fundId, 'member-id')).outcome).toBe('LAST_MANAGER');
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rechaza el archivado si un movimiento concurrente deja saldo', async () => {
    const update = vi.fn(async () => undefined);
    const repository = {
      find: vi.fn(async () => ({ id: fundId, archivedAt: null })),
      fundMember: vi.fn(async () => ({ id: 'member-id', role: FundRole.MANAGER })),
      balances: vi.fn(async () => new Map([[fundId, 0]])),
      update,
      archiveAtomic: vi.fn(async () => ({ outcome: 'NON_ZERO' as const })),
    };
    const groups = {
      requireRole: vi.fn(async () => ({
        id: 'group-member-id',
        groupId,
        userId: 'user-id',
        role: GroupRole.OWNER,
      })),
    };
    await expect(
      new FundsService(repository as never, groups as never).archive('user-id', groupId, fundId),
    ).rejects.toMatchObject({ code: 'FUND_BALANCE_NOT_ZERO' });
    expect(update).not.toHaveBeenCalled();
  });

  it('devuelve el archivado con el contrato de fondo que consume la app', async () => {
    const fund = {
      id: fundId,
      groupId,
      name: 'Caja',
      description: null,
      currency: 'USD',
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const repository = {
      find: vi.fn(async () => ({ ...fund, archivedAt: null })),
      fundMember: vi.fn(async () => ({ id: 'member-id', role: FundRole.MANAGER })),
      archiveAtomic: vi.fn(async () => ({ outcome: 'ARCHIVED' as const, fund })),
    };
    const groups = {
      requireRole: vi.fn(async () => ({
        id: 'group-member-id',
        groupId,
        userId: 'user-id',
        role: GroupRole.OWNER,
      })),
    };
    const result = await new FundsService(repository as never, groups as never).archive(
      'user-id',
      groupId,
      fundId,
    );
    expect(result).toMatchObject({
      id: fundId,
      archivedAt: fund.archivedAt,
      balanceCents: 0,
      myRole: FundRole.MANAGER,
      canManage: true,
    });
  });
});
