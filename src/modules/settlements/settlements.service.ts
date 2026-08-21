import { EventStatus, GroupRole, TransferStatus } from '@prisma/client';
import { requestHash } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { assertExactTotal } from '../../shared/money.js';
import { calculateSettlement, type ParticipantBalance } from '../../shared/settlement.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { CreateSettlementInput } from './settlements.schema.js';
import type { SettlementsRepository } from './settlements.repository.js';

/** Calcula cierres desde gastos y autoriza transiciones de pago. */
export class SettlementsService {
  constructor(
    private readonly repository: SettlementsRepository,
    private readonly groups: GroupsService,
  ) {}

  async create(
    userId: string,
    groupId: string,
    key: string,
    requestId: string,
    input: CreateSettlementInput,
  ) {
    await this.groups.requireRole(userId, groupId, [GroupRole.OWNER, GroupRole.ADMIN]);
    const hash = requestHash(input);
    const scope = `settlement:create:${groupId}`;
    const replay = await this.repository.findIdempotency(userId, scope, key);
    if (replay) {
      ensure(
        replay.requestHash === hash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'La llave ya se uso con otra solicitud',
      );
      return { data: replay.responseBody, replayed: true };
    }
    const context = await this.repository.context(groupId, input.eventId);
    ensure(context, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    ensure(
      context.status === EventStatus.OPEN && !context.settlement,
      409,
      'SETTLEMENT_EXISTS',
      'El evento ya fue cerrado',
    );
    ensure(
      context.expenses.length > 0,
      422,
      'EMPTY_SETTLEMENT',
      'No se liquida un evento sin gastos',
    );
    const currencies = new Set(context.expenses.map((expense) => expense.currency));
    ensure(currencies.size === 1, 422, 'CURRENCY_MISMATCH', 'Los gastos no comparten una moneda');

    const balances: ParticipantBalance[] = [];
    for (const expense of context.expenses) {
      assertExactTotal(
        expense.totalCents,
        expense.participants.map((item) => item.shareCents),
        'SHARES_MISMATCH',
      );
      assertExactTotal(
        expense.totalCents,
        expense.payers.map((item) => item.amountCents),
        'PAYERS_MISMATCH',
      );
      balances.push(
        ...expense.participants.map((item) => ({
          participantId: item.eventParticipantId,
          shareCents: item.shareCents,
          paidCents: 0,
        })),
        ...expense.payers.map((item) => ({
          participantId: item.expenseParticipant.eventParticipantId,
          shareCents: 0,
          paidCents: item.amountCents,
        })),
      );
    }
    const transfers = calculateSettlement(balances);
    try {
      const result = await this.repository.createAtomic({
        groupId,
        eventId: input.eventId,
        userId,
        requestId,
        key,
        requestHash: hash,
        currency: context.expenses[0]!.currency,
        expenseIds: context.expenses.map((expense) => expense.id),
        transfers,
      });
      ensure(
        result.requestHash === hash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'La llave ya se uso con otra solicitud',
      );
      return { data: result.data, replayed: result.replayed };
    } catch (error) {
      if (
        error instanceof Error &&
        ['SETTLEMENT_EXISTS', 'EVENT_CHANGED'].includes(error.message)
      ) {
        throw new AppError(
          409,
          error.message,
          'El evento cambio o ya fue cerrado; reintente con datos actuales',
        );
      }
      throw error;
    }
  }

  async list(userId: string, groupId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    return this.repository.list(groupId);
  }

  async detail(userId: string, groupId: string, settlementId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const settlement = await this.repository.detail(groupId, settlementId);
    ensure(settlement, 404, 'SETTLEMENT_NOT_FOUND', 'Liquidacion no encontrada');
    return settlement;
  }

  async markPaid(
    userId: string,
    groupId: string,
    settlementId: string,
    transferId: string,
    requestId: string,
  ) {
    const membership = await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const transfer = await this.repository.transferContext(groupId, settlementId, transferId);
    ensure(transfer, 404, 'TRANSFER_NOT_FOUND', 'Transferencia no encontrada');
    const privileged = membership.role === GroupRole.OWNER || membership.role === GroupRole.ADMIN;
    ensure(
      privileged || transfer.debtor.groupMember?.userId === userId,
      403,
      'FORBIDDEN',
      'Solo el deudor o un administrador puede marcar el pago',
    );
    ensure(
      transfer.status === TransferStatus.PENDING || transfer.status === TransferStatus.PAID,
      409,
      'TRANSFER_TERMINAL_STATUS',
      'La transferencia termino con un estado distinto de pagada',
    );
    ensure(
      transfer.status === TransferStatus.PAID || transfer.settlement.status === 'OPEN',
      409,
      'SETTLEMENT_TERMINAL_STATUS',
      'La liquidacion ya no admite pagos',
    );
    const updated = await this.repository.markPaid({
      groupId,
      settlementId,
      transferId,
      userId,
      requestId,
    });
    ensure(updated, 404, 'TRANSFER_NOT_FOUND', 'Transferencia no encontrada');
    ensure(
      updated.status === TransferStatus.PAID,
      409,
      'TRANSFER_TERMINAL_STATUS',
      'La transferencia termino con un estado distinto de pagada',
    );
    return updated;
  }
}
