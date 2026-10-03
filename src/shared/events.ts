import type { BackgroundTasks } from '../infrastructure/background.js';

/** Hechos de dominio emitidos tras confirmar una transacción; consumidos por avisos y logros. */
export type DomainEvent =
  | { type: 'group.created'; groupId: string; userId: string }
  | { type: 'event.created'; groupId: string; eventId: string; userId: string }
  | {
      type: 'invitation.created';
      groupId: string;
      invitationId: string;
      email: string;
      userId: string;
    }
  | {
      type: 'invitation.accepted';
      groupId: string;
      invitationId: string;
      userId: string;
      inviterId: string;
    }
  | { type: 'expense.created'; groupId: string; expenseId: string; userId: string }
  | {
      type: 'settlement.created';
      groupId: string;
      settlementId: string;
      eventId: string;
      userId: string;
    }
  | {
      type: 'transfer.paid';
      groupId: string;
      settlementId: string;
      transferId: string;
      userId: string;
    }
  | { type: 'fund.movement'; groupId: string; fundId: string; movementId: string; userId: string }
  | { type: 'ocr.finished'; jobId: string; userId: string; status: 'SUCCEEDED' | 'FAILED' }
  | {
      type: 'privacy.updated';
      userId: string;
      privacyRequestId: string;
      status: string;
      requestType: string;
    };

export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

/** Bus en proceso: los manejadores corren en segundo plano y sus fallos no afectan la petición. */
export class DomainEvents {
  private readonly handlers: DomainEventHandler[] = [];

  constructor(private readonly background?: BackgroundTasks) {}

  subscribe(handler: DomainEventHandler): void {
    this.handlers.push(handler);
  }

  emit(event: DomainEvent): void {
    for (const handler of this.handlers) {
      if (this.background) this.background.run(`event.${event.type}`, () => handler(event));
      else void handler(event).catch(() => undefined);
    }
  }
}
