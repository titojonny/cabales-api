import { FundAccessPolicy, GroupRole, type Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { ensure } from '../../shared/errors.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type {
  CalendarQuery,
  CommentInput,
  CreateShareLinkInput,
  EventFundsInput,
} from './collaboration.schema.js';

const ALL_ROLES = [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER] as const;
const MANAGERS = [GroupRole.OWNER, GroupRole.ADMIN] as const;

const publicSummaryEventSelect = {
  id: true,
  name: true,
  status: true,
  groupId: true,
  group: { select: { currency: true } },
  expenses: { select: { totalCents: true, currency: true } },
  settlement: {
    select: {
      id: true,
      status: true,
      currency: true,
      transfers: {
        select: {
          amountCents: true,
          status: true,
          debtor: {
            select: {
              guestName: true,
              groupMember: { select: { user: { select: { displayName: true } } } },
            },
          },
          creditor: {
            select: {
              guestName: true,
              groupMember: { select: { user: { select: { displayName: true } } } },
            },
          },
        },
      },
    },
  },
  participants: {
    select: {
      id: true,
      guestName: true,
      groupMember: { select: { user: { select: { displayName: true } } } },
    },
  },
} as const;

type PublicSummaryEvent = Prisma.EventGetPayload<{ select: typeof publicSummaryEventSelect }>;

/** Capacidades de colaboración P8 con consultas siempre acotadas por grupo. */
export class CollaborationService {
  constructor(
    private readonly db: Database,
    private readonly groups: {
      requireRole: (
        userId: string,
        groupId: string,
        roles: readonly GroupRole[],
      ) => Promise<{ id: string; role: GroupRole }>;
    },
    private readonly options: { appOrigin: string; notifications?: NotificationsService } = {
      appOrigin: '',
    },
  ) {}

  private async event(userId: string, groupId: string, eventId: string, managers = false) {
    await this.groups.requireRole(userId, groupId, managers ? MANAGERS : ALL_ROLES);
    const event = await this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: { id: true, createdById: true, groupId: true },
    });
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return event;
  }

  async listComments(userId: string, groupId: string, eventId: string) {
    await this.event(userId, groupId, eventId);
    return this.db.eventComment.findMany({
      where: { eventId, event: { groupId } },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        authorUserId: true,
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  }

  async createComment(userId: string, groupId: string, eventId: string, input: CommentInput) {
    await this.event(userId, groupId, eventId);
    const comment = await this.db.eventComment.create({
      data: { eventId, authorUserId: userId, body: input.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        authorUserId: true,
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
    const participants = await this.db.eventParticipant.findMany({
      where: { eventId, groupMemberId: { not: null } },
      select: { groupMember: { select: { userId: true } } },
    });
    const userIds = participants
      .map((participant) => participant.groupMember?.userId)
      .filter((id): id is string => Boolean(id) && id !== userId);
    if (this.options.notifications && userIds.length > 0) {
      await this.options.notifications.notify({
        userIds,
        type: 'event.comment',
        title: 'Nuevo comentario en un evento',
        body: `${comment.author.displayName}: ${comment.body.slice(0, 160)}`,
        data: { groupId, eventId },
      });
    }
    return comment;
  }

  private async commentAccess(userId: string, groupId: string, eventId: string, commentId: string) {
    const membership = await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const comment = await this.db.eventComment.findFirst({
      where: { id: commentId, eventId, event: { id: eventId, groupId } },
      select: { id: true, authorUserId: true },
    });
    ensure(comment, 404, 'COMMENT_NOT_FOUND', 'Comentario no encontrado');
    const privileged = membership.role === GroupRole.OWNER || membership.role === GroupRole.ADMIN;
    ensure(
      privileged || comment.authorUserId === userId,
      403,
      'COMMENT_FORBIDDEN',
      'Solo puedes modificar tus propios comentarios',
    );
    return comment;
  }

  async updateComment(
    userId: string,
    groupId: string,
    eventId: string,
    commentId: string,
    input: CommentInput,
  ) {
    await this.commentAccess(userId, groupId, eventId, commentId);
    return this.db.eventComment.update({
      where: { id: commentId },
      data: { body: input.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        authorUserId: true,
        author: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  async deleteComment(userId: string, groupId: string, eventId: string, commentId: string) {
    await this.commentAccess(userId, groupId, eventId, commentId);
    await this.db.eventComment.deleteMany({
      where: { id: commentId, eventId, event: { groupId } },
    });
  }

  async replaceEventFunds(
    userId: string,
    groupId: string,
    eventId: string,
    input: EventFundsInput,
  ) {
    const event = await this.event(userId, groupId, eventId, true);
    const funds = await this.db.fund.findMany({
      where: { id: { in: input.fundIds }, groupId, archivedAt: null },
      select: { id: true, currency: true },
    });
    ensure(
      funds.length === input.fundIds.length,
      422,
      'FUND_OUTSIDE_GROUP',
      'Un fondo no pertenece al grupo o esta archivado',
    );
    const group = await this.db.group.findUnique({
      where: { id: groupId },
      select: { currency: true },
    });
    ensure(
      funds.every((fund) => fund.currency === group?.currency),
      422,
      'CURRENCY_MISMATCH',
      'Los fondos deben usar la moneda del grupo',
    );
    await this.db.$transaction(async (tx) => {
      await tx.eventFund.deleteMany({ where: { eventId: event.id } });
      if (input.fundIds.length > 0)
        await tx.eventFund.createMany({
          data: input.fundIds.map((fundId) => ({ eventId, fundId })),
        });
    });
    return this.eventFunds(userId, groupId, eventId);
  }

  async eventFunds(userId: string, groupId: string, eventId: string) {
    await this.event(userId, groupId, eventId);
    const links = await this.db.eventFund.findMany({
      where: { eventId, event: { groupId } },
      select: {
        fund: {
          select: {
            id: true,
            name: true,
            currency: true,
            movements: { select: { type: true, amountCents: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return links.map(({ fund }) => ({
      fundId: fund.id,
      name: fund.name,
      currency: fund.currency,
      balanceCents: fund.movements.reduce((sum, movement) => sum + movement.amountCents, 0),
      contributionsCents: fund.movements
        .filter((movement) => movement.type === 'CONTRIBUTION')
        .reduce((sum, movement) => sum + movement.amountCents, 0),
      movementCount: fund.movements.length,
    }));
  }

  async createShareLink(userId: string, groupId: string, input: CreateShareLinkInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    if (input.eventId) {
      await this.event(userId, groupId, input.eventId);
    } else {
      ensure(input.settlementId, 400, 'VALIDATION_ERROR', 'Indica una liquidacion');
      const settlement = await this.db.settlement.findFirst({
        where: { id: input.settlementId, groupId },
        select: { id: true },
      });
      ensure(settlement, 404, 'SETTLEMENT_NOT_FOUND', 'Liquidacion no encontrada');
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const link = await this.db.publicShareLink.create({
      data: {
        groupId,
        createdById: userId,
        tokenHash: hashToken(token),
        expiresAt,
        ...(input.eventId ? { eventId: input.eventId } : { settlementId: input.settlementId! }),
      },
      select: { id: true, eventId: true, settlementId: true, expiresAt: true, createdAt: true },
    });
    return {
      ...link,
      url: `${this.options.appOrigin.replace(/\/+$/, '')}/share/summaries/${token}`,
    };
  }

  async listShareLinks(userId: string, groupId: string) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    return this.db.publicShareLink.findMany({
      where: { groupId },
      select: {
        id: true,
        eventId: true,
        settlementId: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async revokeShareLink(userId: string, groupId: string, linkId: string) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const updated = await this.db.publicShareLink.updateMany({
      where: { id: linkId, groupId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    ensure(updated.count === 1, 404, 'SHARE_LINK_NOT_FOUND', 'Enlace compartido no encontrado');
  }

  async publicSummary(token: string) {
    ensure(
      /^[A-Za-z0-9_-]{40,64}$/.test(token),
      404,
      'SHARE_LINK_NOT_FOUND',
      'Este enlace no esta disponible',
    );
    const link = await this.db.publicShareLink.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        groupId: true,
        expiresAt: true,
        eventId: true,
        settlementId: true,
        group: { select: { name: true } },
      },
    });
    ensure(link, 404, 'SHARE_LINK_NOT_FOUND', 'Este enlace no esta disponible');
    ensure(
      Boolean(link.eventId) !== Boolean(link.settlementId),
      404,
      'SHARE_LINK_NOT_FOUND',
      'Este enlace no esta disponible',
    );
    const event: PublicSummaryEvent | null = await this.db.event.findFirst({
      where: link.eventId
        ? { groupId: link.groupId, id: link.eventId }
        : { groupId: link.groupId, settlement: { id: link.settlementId!, groupId: link.groupId } },
      select: publicSummaryEventSelect,
    });
    ensure(event, 404, 'SHARE_LINK_NOT_FOUND', 'Este enlace no esta disponible');
    const settlement = event.settlement;
    const transfers = settlement?.transfers ?? [];
    const label = (participant: {
      guestName: string | null;
      groupMember: { user: { displayName: string } } | null;
    }) => participant.groupMember?.user.displayName ?? participant.guestName ?? 'Participante';
    return {
      type: link.settlementId ? 'SETTLEMENT' : 'EVENT',
      expiresAt: link.expiresAt,
      groupName: link.group.name,
      eventName: event.name,
      status: settlement?.status ?? event.status,
      currency: settlement?.currency ?? event.group.currency,
      totalCents: event.expenses.reduce((sum, expense) => sum + expense.totalCents, 0),
      participants: event.participants.map((participant) => ({
        displayName:
          participant.groupMember?.user.displayName ?? participant.guestName ?? 'Participante',
      })),
      transfers: transfers.map((transfer) => ({
        debtor: label(transfer.debtor),
        creditor: label(transfer.creditor),
        amountCents: transfer.amountCents,
        status: transfer.status,
      })),
    };
  }

  async repeatEvent(userId: string, groupId: string, eventId: string) {
    await this.event(userId, groupId, eventId);
    const event = await this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: {
        name: true,
        description: true,
        startsAt: true,
        endsAt: true,
        locationName: true,
        locationAddress: true,
        mapsUrl: true,
        timeZone: true,
        participants: { select: { groupMemberId: true, guestName: true } },
        links: { select: { label: true, url: true } },
      },
    });
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return {
      name: `${event.name} (copia)`,
      description: event.description ?? undefined,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString(),
      locationName: event.locationName ?? undefined,
      locationAddress: event.locationAddress ?? undefined,
      mapsUrl: event.mapsUrl ?? undefined,
      timeZone: event.timeZone ?? undefined,
      memberIds: event.participants.flatMap((participant) =>
        participant.groupMemberId ? [participant.groupMemberId] : [],
      ),
      guests: event.participants.flatMap((participant) =>
        participant.guestName ? [participant.guestName] : [],
      ),
      links: event.links,
    };
  }

  async repeatExpense(userId: string, groupId: string, expenseId: string) {
    await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const expense = await this.db.expense.findFirst({
      where: { id: expenseId, groupId },
      select: {
        eventId: true,
        title: true,
        notes: true,
        totalCents: true,
        subtotalCents: true,
        taxCents: true,
        tipCents: true,
        currency: true,
        splitMode: true,
        occurredAt: true,
        categoryId: true,
        participants: { select: { eventParticipantId: true, shareCents: true } },
        payers: {
          select: {
            amountCents: true,
            expenseParticipant: { select: { eventParticipantId: true } },
          },
        },
        items: {
          select: {
            name: true,
            amountCents: true,
            quantity: true,
            allocations: {
              select: {
                amountCents: true,
                expenseParticipant: { select: { eventParticipantId: true } },
              },
            },
          },
        },
        tags: { select: { tagId: true } },
      },
    });
    ensure(expense, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
    const participantIds = expense.participants.map(
      (participant) => participant.eventParticipantId,
    );
    const percentageBase = expense.subtotalCents > 0 ? expense.subtotalCents : expense.totalCents;
    const percentageBps = expense.participants.map((participant) =>
      Math.floor((participant.shareCents * 10_000) / percentageBase),
    );
    let percentageRemainder = 10_000 - percentageBps.reduce((sum, value) => sum + value, 0);
    for (let index = 0; percentageRemainder > 0 && index < percentageBps.length; index += 1) {
      percentageBps[index] = (percentageBps[index] ?? 0) + 1;
      percentageRemainder -= 1;
    }
    return {
      eventId: expense.eventId,
      title: `${expense.title} (copia)`,
      notes: expense.notes ?? undefined,
      totalCents: expense.totalCents,
      ...(expense.subtotalCents > 0 ? { subtotalCents: expense.subtotalCents } : {}),
      ...(expense.taxCents > 0 ? { taxCents: expense.taxCents } : {}),
      ...(expense.tipCents > 0 ? { tipCents: expense.tipCents } : {}),
      currency: expense.currency,
      splitMode: expense.splitMode,
      occurredAt: new Date().toISOString(),
      categoryId: expense.categoryId ?? undefined,
      participants: expense.participants.map((participant, index) => ({
        eventParticipantId: participant.eventParticipantId,
        shareCents: expense.splitMode === 'PERCENT' ? undefined : participant.shareCents,
        ...(expense.splitMode === 'PERCENT' ? { percentageBps: percentageBps[index] } : {}),
      })),
      payers: expense.payers.map((payer) => ({
        eventParticipantId: payer.expenseParticipant.eventParticipantId,
        amountCents: payer.amountCents,
      })),
      items: expense.items.map((item) => ({
        name: item.name,
        amountCents: item.amountCents,
        quantity: item.quantity,
        allocations: item.allocations.map((allocation) => ({
          eventParticipantId: allocation.expenseParticipant.eventParticipantId,
          amountCents: allocation.amountCents,
        })),
      })),
      tagIds: expense.tags.map((tag) => tag.tagId),
      participantIds,
    };
  }

  async calendar(userId: string, query: CalendarQuery) {
    const events = await this.db.event.findMany({
      where: {
        group: { members: { some: { userId } } },
        startsAt: { lt: query.to },
        OR: [{ endsAt: null }, { endsAt: { gte: query.from } }],
      },
      select: {
        id: true,
        groupId: true,
        name: true,
        description: true,
        startsAt: true,
        endsAt: true,
        status: true,
        locationName: true,
        group: { select: { name: true, currency: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return events;
  }

  static policyAllows(
    policy: FundAccessPolicy,
    groupRole: GroupRole,
    fundRole: 'MANAGER' | 'MEMBER' | null,
  ) {
    if (policy === FundAccessPolicy.GROUP_ADMINS) return groupRole !== GroupRole.MEMBER;
    if (policy === FundAccessPolicy.MANAGERS)
      return groupRole !== GroupRole.MEMBER || fundRole === 'MANAGER';
    return Boolean(fundRole);
  }
}
