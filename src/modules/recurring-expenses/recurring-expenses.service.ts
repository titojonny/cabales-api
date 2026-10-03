import { EventStatus, GroupRole, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { ensure } from '../../shared/errors.js';
import { assertCurrency } from '../../shared/money.js';
import type { DomainEvents } from '../../shared/events.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type {
  CreateGroupRecurringInput,
  CreatePersonalRecurringInput,
  UpdateRecurringInput,
} from './recurring-expenses.schema.js';

const MANAGERS = [GroupRole.OWNER, GroupRole.ADMIN] as const;
const recurringView = {
  id: true,
  groupId: true,
  eventId: true,
  ownerUserId: true,
  createdById: true,
  title: true,
  notes: true,
  amountCents: true,
  currency: true,
  categoryId: true,
  frequency: true,
  chargeDay: true,
  nextRunAt: true,
  endsAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, color: true } },
  participants: { select: { eventParticipantId: true, shareCents: true, payerAmountCents: true } },
  tags: { select: { tag: { select: { id: true, name: true, groupId: true, ownerUserId: true } } } },
} as const;

function nextDate(date: Date, frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY', chargeDay: number) {
  const result = new Date(date);
  if (frequency === 'WEEKLY') {
    result.setUTCDate(result.getUTCDate() + 7);
    return result;
  }
  const month = result.getUTCMonth() + (frequency === 'YEARLY' ? 12 : 1);
  result.setUTCDate(1);
  result.setUTCMonth(month);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(chargeDay, lastDay));
  return result;
}

function periodKey(date: Date, frequency: string) {
  return `${frequency}:${date.toISOString().slice(0, 10)}`;
}

/** CRUD y ejecución idempotente de gastos recurrentes personales y de grupos. */
export class RecurringExpensesService {
  constructor(
    private readonly db: Database,
    private readonly groups: GroupsService,
    private readonly notifications?: NotificationsService,
    private readonly events?: DomainEvents,
  ) {}

  private async references(
    userId: string,
    input: {
      categoryId?: string | null | undefined;
      tagIds?: string[] | undefined;
    },
    groupId?: string,
  ) {
    const tagIds = input.tagIds ?? [];
    ensure(
      new Set(tagIds).size === tagIds.length,
      422,
      'DUPLICATE_TAG',
      'Hay etiquetas duplicadas',
    );
    if (input.categoryId) {
      const category = await this.db.category.findFirst({
        where: groupId
          ? { id: input.categoryId, OR: [{ groupId }, { groupId: null, ownerUserId: null }] }
          : {
              id: input.categoryId,
              OR: [{ ownerUserId: userId }, { groupId: null, ownerUserId: null }],
            },
        select: { id: true },
      });
      ensure(category, 422, 'CATEGORY_OUTSIDE_SCOPE', 'La categoria no pertenece al alcance');
    }
    if (tagIds.length > 0) {
      const tags = await this.db.tag.findMany({
        where: groupId
          ? { id: { in: tagIds }, groupId }
          : { id: { in: tagIds }, ownerUserId: userId },
        select: { id: true },
      });
      ensure(
        tags.length === tagIds.length,
        422,
        'TAG_OUTSIDE_SCOPE',
        'Una etiqueta no pertenece al alcance',
      );
    }
  }

  async listPersonal(userId: string) {
    return this.db.recurringExpense.findMany({
      where: { ownerUserId: userId },
      select: recurringView,
      orderBy: { nextRunAt: 'asc' },
      take: 100,
    });
  }

  async createPersonal(userId: string, input: CreatePersonalRecurringInput) {
    assertCurrency(input.currency);
    await this.references(userId, input);
    return this.db.recurringExpense.create({
      data: {
        ownerUserId: userId,
        createdById: userId,
        title: input.title,
        ...(input.notes ? { notes: input.notes } : {}),
        amountCents: input.amountCents,
        currency: input.currency,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        frequency: input.frequency,
        chargeDay: input.chargeDay,
        nextRunAt: input.nextRunAt,
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.tagIds.length > 0
          ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      select: recurringView,
    });
  }

  async listGroup(userId: string, groupId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    return this.db.recurringExpense.findMany({
      where: { groupId },
      select: recurringView,
      orderBy: { nextRunAt: 'asc' },
      take: 100,
    });
  }

  async createGroup(userId: string, groupId: string, input: CreateGroupRecurringInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const [group, event] = await Promise.all([
      this.db.group.findUnique({ where: { id: groupId }, select: { currency: true } }),
      this.db.event.findFirst({
        where: { id: input.eventId, groupId },
        select: {
          id: true,
          status: true,
          settlement: { select: { id: true } },
          participants: { select: { id: true, groupMemberId: true } },
        },
      }),
    ]);
    ensure(group && event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    ensure(
      event.status === EventStatus.OPEN && !event.settlement,
      409,
      'EVENT_LOCKED',
      'El evento ya no admite gastos',
    );
    ensure(
      group.currency === input.currency,
      422,
      'CURRENCY_MISMATCH',
      'La moneda no coincide con el grupo',
    );
    await this.references(userId, input, groupId);
    const available = new Set(event.participants.map((participant) => participant.id));
    ensure(
      input.participants.every((participant) => available.has(participant.eventParticipantId)),
      422,
      'PARTICIPANT_OUTSIDE_EVENT',
      'Un participante no pertenece al evento',
    );
    return this.db.recurringExpense.create({
      data: {
        groupId,
        eventId: input.eventId,
        createdById: userId,
        title: input.title,
        ...(input.notes ? { notes: input.notes } : {}),
        amountCents: input.amountCents,
        currency: input.currency,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        frequency: input.frequency,
        chargeDay: input.chargeDay,
        nextRunAt: input.nextRunAt,
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        participants: {
          create: input.participants.map((participant) => ({
            eventParticipantId: participant.eventParticipantId,
            shareCents: participant.shareCents,
            ...(participant.payerAmountCents !== undefined
              ? { payerAmountCents: participant.payerAmountCents }
              : {}),
          })),
        },
        ...(input.tagIds.length > 0
          ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      select: recurringView,
    });
  }

  private async access(userId: string, id: string, groupId?: string) {
    const row = await this.db.recurringExpense.findFirst({
      where: { id, ...(groupId ? { groupId } : { ownerUserId: userId }) },
      select: {
        id: true,
        groupId: true,
        ownerUserId: true,
        createdById: true,
        frequency: true,
        chargeDay: true,
        nextRunAt: true,
        endsAt: true,
      },
    });
    ensure(row, 404, 'RECURRING_NOT_FOUND', 'Gasto recurrente no encontrado');
    if (row.groupId) await this.groups.requireRole(userId, row.groupId, MANAGERS);
    return row;
  }

  async update(userId: string, id: string, input: UpdateRecurringInput, groupId?: string) {
    const current = await this.access(userId, id, groupId);
    await this.references(userId, input, groupId);
    const frequency = input.frequency ?? current.frequency;
    const chargeDay = input.chargeDay ?? current.chargeDay;
    const nextRunAt = input.nextRunAt ?? current.nextRunAt;
    const endsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;
    ensure(
      frequency !== 'WEEKLY' || chargeDay <= 7,
      422,
      'INVALID_CHARGE_DAY',
      'La semana usa un dia entre 1 y 7',
    );
    ensure(
      !endsAt || endsAt > nextRunAt,
      422,
      'INVALID_END_DATE',
      'endsAt debe ser posterior a nextRunAt',
    );
    return this.db.recurringExpense.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.chargeDay !== undefined ? { chargeDay: input.chargeDay } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.nextRunAt !== undefined ? { nextRunAt: input.nextRunAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.tagIds !== undefined
          ? { tags: { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      select: recurringView,
    });
  }

  async setActive(userId: string, id: string, active: boolean, groupId?: string) {
    await this.access(userId, id, groupId);
    return this.db.recurringExpense.update({
      where: { id },
      data: { isActive: active },
      select: recurringView,
    });
  }

  async delete(userId: string, id: string, groupId?: string) {
    await this.access(userId, id, groupId);
    await this.db.recurringExpense.delete({ where: { id } });
  }

  /** Procesa cada vencimiento bajo bloqueo de fila y con una clave única por periodo. */
  async runDue(now = new Date()) {
    const due = await this.db.recurringExpense.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const row of due) await this.runOne(row.id, now);
  }

  private async runOne(id: string, now: Date) {
    let outcome:
      | { kind: 'created'; expenseId: string; groupId: string | null; responsibleId: string }
      | { kind: 'paused'; responsibleId: string; reason: string }
      | null;
    try {
      outcome = await this.db.$transaction(
        async (tx) => {
          const recurring = await tx.recurringExpense.findUnique({
            where: { id },
            include: { participants: true, tags: true },
          });
          if (!recurring || !recurring.isActive || recurring.nextRunAt > now) return null;
          const responsibleId = recurring.ownerUserId ?? recurring.createdById;
          if (!responsibleId) {
            await tx.recurringExpense.update({ where: { id }, data: { isActive: false } });
            return null;
          }
          if (recurring.endsAt && recurring.nextRunAt > recurring.endsAt) {
            await tx.recurringExpense.update({ where: { id }, data: { isActive: false } });
            return { kind: 'paused' as const, responsibleId, reason: 'La fecha final ya vencio' };
          }
          const key = periodKey(recurring.nextRunAt, recurring.frequency);
          if (recurring.groupId) {
            if (!recurring.eventId) {
              await tx.recurringExpense.update({ where: { id }, data: { isActive: false } });
              return {
                kind: 'paused' as const,
                responsibleId,
                reason: 'Falta el evento del gasto grupal',
              };
            }
            const event = await tx.event.findFirst({
              where: { id: recurring.eventId, groupId: recurring.groupId },
              select: {
                status: true,
                settlement: { select: { id: true } },
                participants: { select: { id: true, groupMemberId: true } },
              },
            });
            if (!event || event.status !== EventStatus.OPEN || event.settlement) {
              await tx.recurringExpense.update({ where: { id }, data: { isActive: false } });
              return {
                kind: 'paused' as const,
                responsibleId,
                reason: 'El evento ya no admite gastos',
              };
            }
            const templateIds = recurring.participants.map(
              (participant) => participant.eventParticipantId,
            );
            if (
              !templateIds.every((participantId) =>
                event.participants.some((participant) => participant.id === participantId),
              )
            ) {
              await tx.recurringExpense.update({ where: { id }, data: { isActive: false } });
              return {
                kind: 'paused' as const,
                responsibleId,
                reason: 'La plantilla ya no coincide con el evento',
              };
            }
            const byId = new Map(
              event.participants.map((participant) => [participant.id, participant.groupMemberId]),
            );
            const expense = await tx.expense.create({
              data: {
                groupId: recurring.groupId,
                eventId: recurring.eventId,
                createdById: responsibleId,
                recurringExpenseId: id,
                recurringPeriodKey: key,
                title: recurring.title,
                ...(recurring.notes ? { notes: recurring.notes } : {}),
                ...(recurring.categoryId ? { categoryId: recurring.categoryId } : {}),
                totalCents: recurring.amountCents,
                subtotalCents: recurring.amountCents,
                taxCents: 0,
                tipCents: 0,
                currency: recurring.currency,
                splitMode: 'EXACT',
                occurredAt: recurring.nextRunAt,
                ...(recurring.tags.length > 0
                  ? { tags: { create: recurring.tags.map((tag) => ({ tagId: tag.tagId })) } }
                  : {}),
              },
            });
            const stored = await tx.expenseParticipant.createManyAndReturn({
              data: recurring.participants.map((participant) => ({
                expenseId: expense.id,
                eventParticipantId: participant.eventParticipantId,
                groupMemberId: byId.get(participant.eventParticipantId) ?? null,
                shareCents: participant.shareCents,
                subtotalCents: participant.shareCents,
                taxCents: 0,
                tipCents: 0,
              })),
              select: { id: true, eventParticipantId: true },
            });
            const participantMap = new Map(
              stored.map((participant) => [participant.eventParticipantId, participant.id]),
            );
            const payers = recurring.participants
              .filter((participant) => participant.payerAmountCents)
              .map((participant) => ({
                expenseId: expense.id,
                expenseParticipantId: participantMap.get(participant.eventParticipantId)!,
                amountCents: participant.payerAmountCents!,
              }));
            await tx.expensePayer.createMany({ data: payers });
            const next = nextDate(recurring.nextRunAt, recurring.frequency, recurring.chargeDay);
            await tx.recurringExpense.update({
              where: { id },
              data: {
                nextRunAt: next,
                ...(recurring.endsAt && next > recurring.endsAt ? { isActive: false } : {}),
              },
            });
            return {
              kind: 'created' as const,
              expenseId: expense.id,
              groupId: recurring.groupId,
              responsibleId,
            };
          }
          const expense = await tx.expense.create({
            data: {
              groupId: null,
              eventId: null,
              ownerUserId: responsibleId,
              createdById: responsibleId,
              recurringExpenseId: id,
              recurringPeriodKey: key,
              title: recurring.title,
              ...(recurring.notes ? { notes: recurring.notes } : {}),
              ...(recurring.categoryId ? { categoryId: recurring.categoryId } : {}),
              totalCents: recurring.amountCents,
              subtotalCents: recurring.amountCents,
              taxCents: 0,
              tipCents: 0,
              currency: recurring.currency,
              splitMode: 'EQUAL',
              occurredAt: recurring.nextRunAt,
              ...(recurring.tags.length > 0
                ? { tags: { create: recurring.tags.map((tag) => ({ tagId: tag.tagId })) } }
                : {}),
            },
          });
          const next = nextDate(recurring.nextRunAt, recurring.frequency, recurring.chargeDay);
          await tx.recurringExpense.update({
            where: { id },
            data: {
              nextRunAt: next,
              ...(recurring.endsAt && next > recurring.endsAt ? { isActive: false } : {}),
            },
          });
          return { kind: 'created' as const, expenseId: expense.id, groupId: null, responsibleId };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    if (!outcome || !this.notifications) return;
    if (outcome.kind === 'created') {
      await this.notifications.notify({
        userIds: [outcome.responsibleId],
        type: 'recurring.expense',
        title: 'Gasto recurrente registrado',
        body: 'Se registro automaticamente un gasto recurrente.',
        data: { recurringExpenseId: id, expenseId: outcome.expenseId },
        dedupeKey: `recurring:${id}:${outcome.expenseId}`,
      });
      if (outcome.groupId)
        this.events?.emit({
          type: 'expense.created',
          groupId: outcome.groupId,
          expenseId: outcome.expenseId,
          userId: outcome.responsibleId,
        });
      else
        this.events?.emit({
          type: 'personal-expense.created',
          expenseId: outcome.expenseId,
          userId: outcome.responsibleId,
        });
    } else {
      await this.notifications.notify({
        userIds: [outcome.responsibleId],
        type: 'recurring.expense',
        title: 'Gasto recurrente pausado',
        body: `No se pudo registrar: ${outcome.reason}. Corrige la plantilla y reanuda el recurrente.`,
        data: { recurringExpenseId: id },
        dedupeKey: `recurring-paused:${id}:${outcome.reason}`,
      });
    }
  }
}
