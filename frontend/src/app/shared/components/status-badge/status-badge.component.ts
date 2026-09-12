import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="status-pill" [ngClass]="statusClass">
      <span class="dot-indicator"></span>
      {{ label }}
    </span>
  `,
  styles: [`
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 9999px;
    }

    .dot-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-activo {
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .status-cerrado {
      background: rgba(148, 163, 184, 0.15);
      color: #94A3B8;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }

    .status-pendiente {
      background: rgba(245, 158, 11, 0.15);
      color: #FBBF24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .status-en_revision {
      background: rgba(59, 130, 246, 0.15);
      color: #60A5FA;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .status-completado {
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .status-en_disputa {
      background: rgba(239, 68, 68, 0.15);
      color: #F87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
  `]
})
export class StatusBadgeComponent {
  @Input() status: string = '';

  get statusClass(): string {
    return `status-${(this.status || '').toLowerCase()}`;
  }

  get label(): string {
    switch (this.status) {
      case 'ACTIVO': return 'Mesa Abierta';
      case 'CERRADO': return 'Mesa Cerrada';
      case 'PENDIENTE': return 'Pendiente';
      case 'EN_REVISION': return 'En Revisión';
      case 'COMPLETADO': return 'Completado';
      case 'EN_DISPUTA': return 'En Disputa';
      default: return this.status;
    }
  }
}
