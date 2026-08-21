import { GroupRole, TransferStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { GroupsService } from '../src/modules/groups/groups.service.js';
import type { SettlementsRepository } from '../src/modules/settlements/settlements.repository.js';
import { SettlementsService } from '../src/modules/settlements/settlements.service.js';

function serviceWithStatus(status: TransferStatus) {
  const repository = {
    transferContext: vi.fn(async () => ({
      id: 'transfer',
      status,
      settlement: { status: 'OPEN' },
      debtor: { groupMember: { userId: 'user' } },
    })),
    markPaid: vi.fn(async () => ({
      id: 'transfer',
      status,
      amountCents: 100,
      paidAt: status === TransferStatus.PAID ? new Date() : null,
    })),
  } as unknown as SettlementsRepository;
  const groups = {
    requireRole: vi.fn(async () => ({
      id: 'member',
      groupId: 'group',
      userId: 'user',
      role: GroupRole.MEMBER,
    })),
  } as unknown as GroupsService;
  return { service: new SettlementsService(repository, groups), repository };
}

describe('SettlementsService.markPaid', () => {
  it('recupera una repetición autorizada cuando ya está PAID', async () => {
    const { service, repository } = serviceWithStatus(TransferStatus.PAID);
    await expect(
      service.markPaid('user', 'group', 'settlement', 'transfer', 'request'),
    ).resolves.toMatchObject({ status: TransferStatus.PAID });
    expect(repository.markPaid).toHaveBeenCalledOnce();
  });

  it('rechaza un estado terminal distinto de PAID', async () => {
    const { service, repository } = serviceWithStatus(TransferStatus.CANCELLED);
    await expect(
      service.markPaid('user', 'group', 'settlement', 'transfer', 'request'),
    ).rejects.toMatchObject({ code: 'TRANSFER_TERMINAL_STATUS' });
    expect(repository.markPaid).not.toHaveBeenCalled();
  });
});
