import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-participant-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="participant-item" [class.is-ghost]="isGhost">
      <div class="avatar-box">
        @if (isGhost) {
          <span class="ghost-emoji">👻</span>
        } @else {
          <span class="user-initial">{{ initial }}</span>
        }
      </div>
      <div class="info-box">
        <span class="name-text">{{ name }}</span>
        <span class="type-label">{{ isGhost ? 'Invitado' : 'Registrado' }}</span>
      </div>
    </div>
  `,
  styles: [`
    .participant-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 4px 10px 4px 6px;
      border-radius: 9999px;
    }

    .avatar-box {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--ion-color-secondary-tint);
    }

    .is-ghost .avatar-box {
      background: rgba(245, 158, 11, 0.2);
    }

    .ghost-emoji {
      font-size: 0.95rem;
    }

    .info-box {
      display: flex;
      flex-direction: column;
      line-height: 1.1;
    }

    .name-text {
      font-size: 0.85rem;
      font-weight: 600;
      color: #F1F5F9;
    }

    .type-label {
      font-size: 0.65rem;
      color: #94A3B8;
    }
  `]
})
export class ParticipantBadgeComponent {
  @Input() name = '';
  @Input() isGhost = false;

  get initial(): string {
    return this.name ? this.name.charAt(0).toUpperCase() : '?';
  }
}
