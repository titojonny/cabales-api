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
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      padding: 4px 10px 4px 6px;
      border-radius: 9999px;
    }

    .avatar-box {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #4DBE55;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      font-weight: 700;
      color: #141F14;
    }

    .is-ghost .avatar-box {
      background: rgba(113, 119, 109, 0.5);
      color: #F1F1F1;
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
      color: #F1F1F1;
    }

    .type-label {
      font-size: 0.65rem;
      color: #BEBEBE;
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
