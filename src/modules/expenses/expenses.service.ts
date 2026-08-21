import { EventStatus, GroupRole, SplitMode } from '@prisma/client';
import { requestHash } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { assertCurrency, assertExactTotal, splitEqual } from '../../shared/money.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { CreateExpenseInput } from './expenses.schema.js';
import type { ExpensesRepository, PreparedExpense } from './expenses.repository.js';

/** Invariantes de reparto y reglas de ciclo de vida de gastos. */
export class ExpensesService {
  constructor(
    private readonly repository: ExpensesRepository,
    private readonly groups: GroupsService,
  ) {}

  async create(
    userId: string,
    groupId: string,
    key: string,
    requestId: string,
    input: CreateExpenseInput,
  ) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const hash = requestHash(input);
    const scope = `expense:create:${groupId}`;
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
      'EVENT_LOCKED',
      'El evento ya no admite gastos',
    );
    assertCurrency(input.currency);
    ensure(
      input.currency === context.group.currency,
      422,
      'CURRENCY_MISMATCH',
      'La moneda no coincide con el grupo',
    );

    const participantIds = input.participants.map((participant) => participant.eventParticipantId);
    ensure(
      new Set(participantIds).size === participantIds.length,
      422,
      'DUPLICATE_PARTICIPANT',
      'Hay participantes duplicados',
    );
    const available = new Map(
      context.participants.map((participant) => [participant.id, participant]),
    );
    ensure(
      participantIds.every((id) => available.has(id)),
      422,
      'PARTICIPANT_OUTSIDE_EVENT',
      'Un participante no pertenece al evento',
    );

    const shares =
      input.splitMode === SplitMode.EQUAL
        ? splitEqual(input.totalCents, participantIds.length)
        : input.participants.map((participant) => {
            ensure(
              participant.shareCents !== undefined,
              422,
              'SHARE_REQUIRED',
              'EXACT requiere shareCents',
            );
            return participant.shareCents;
          });
    if (input.splitMode === SplitMode.EQUAL) {
      ensure(
        input.participants.every((participant) => participant.shareCents === undefined),
        422,
        'UNEXPECTED_SHARE',
        'EQUAL calcula las partes automaticamente',
      );
    }
    assertExactTotal(input.totalCents, shares, 'SHARES_MISMATCH');

    const selected = new Set(participantIds);
    this.validateAllocations(input.payers, selected, input.totalCents, 'PAYERS_MISMATCH');
    if (input.items) {
      assertExactTotal(
        input.totalCents,
        input.items.map((item) => item.amountCents),
        'ITEMS_MISMATCH',
      );
      const allocatedByParticipant = new Map<string, number>();
      for (const item of input.items) {
        this.validateAllocations(
          item.allocations,
          selected,
          item.amountCents,
          'ITEM_ALLOCATIONS_MISMATCH',
        );
        for (const allocation of item.allocations) {
          allocatedByParticipant.set(
            allocation.eventParticipantId,
            (allocatedByParticipant.get(allocation.eventParticipantId) ?? 0) +
              allocation.amountCents,
          );
        }
      }
      participantIds.forEach((id, index) =>
        ensure(
          allocatedByParticipant.get(id) === shares[index],
          422,
          'ITEM_SHARES_MISMATCH',
          'Los items no coinciden con las partes del gasto',
        ),
      );
    }

    const expense: PreparedExpense = {
      eventId: input.eventId,
      title: input.title,
      ...(input.notes ? { notes: input.notes } : {}),
      totalCents: input.totalCents,
      currency: input.currency,
      splitMode: input.splitMode as SplitMode,
      occurredAt: input.occurredAt,
      participants: participantIds.map((eventParticipantId, index) => ({
        eventParticipantId,
        shareCents: shares[index]!,
      })),
      payers: input.payers,
      items: input.items ?? [],
    };
    try {
      const result = await this.repository.createAtomic({
        groupId,
        userId,
        requestId,
        key,
        requestHash: hash,
        expense,
      });
      ensure(
        result.requestHash === hash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'La llave ya se uso con otra solicitud',
      );
      return { data: result.data, replayed: result.replayed };
    } catch (error) {
      if (error instanceof Error && error.message === 'EVENT_LOCKED') {
        throw new AppError(409, 'EVENT_LOCKED', 'El evento ya no admite gastos');
      }
      if (error instanceof Error && error.message === 'CURRENCY_MISMATCH') {
        throw new AppError(422, 'CURRENCY_MISMATCH', 'La moneda no coincide con el grupo');
      }
      if (error instanceof Error && error.message === 'PARTICIPANT_OUTSIDE_EVENT') {
        throw new AppError(
          422,
          'PARTICIPANT_OUTSIDE_EVENT',
          'Un participante no pertenece al evento',
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

  async detail(userId: string, groupId: string, expenseId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const expense = await this.repository.detail(groupId, expenseId);
    ensure(expense, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
    return expense;
  }

  private validateAllocations(
    allocations: Array<{ eventParticipantId: string; amountCents: number }>,
    selected: Set<string>,
    totalCents: number,
    code: string,
  ): void {
    const ids = allocations.map((allocation) => allocation.eventParticipantId);
    ensure(
      new Set(ids).size === ids.length,
      422,
      'DUPLICATE_ALLOCATION',
      'Hay asignaciones duplicadas',
    );
    ensure(
      ids.every((id) => selected.has(id)),
      422,
      'ALLOCATION_OUTSIDE_EXPENSE',
      'Una asignacion no pertenece al gasto',
    );
    assertExactTotal(
      totalCents,
      allocations.map((allocation) => allocation.amountCents),
      code,
    );
  }
}
