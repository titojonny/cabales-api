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
      background: rgba(77, 190, 85, 0.16);
      color: #79ED91;
      border: 1px solid rgba(77, 190, 85, 0.4);
    }

    .status-cerrado {
      background: rgba(113, 119, 109, 0.2);
      color: #BEBEBE;
      border: 1px solid rgba(113, 119, 109, 0.35);
    }

    .status-pendiente {
      background: rgba(239, 68, 68, 0.16);
      color: #FCA5A5;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }

    .status-en_revision {
      background: rgba(105, 134, 150, 0.2);
      color: #F1F1F1;
      border: 1px solid rgba(105, 134, 150, 0.4);
    }

    .status-completado {
      background: rgba(121, 237, 145, 0.16);
      color: #79ED91;
      border: 1px solid rgba(121, 237, 145, 0.4);
    }

    .status-en_disputa {
      background: rgba(239, 68, 68, 0.2);
      color: #FCA5A5;
      border: 1px solid rgba(239, 68, 68, 0.45);
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
