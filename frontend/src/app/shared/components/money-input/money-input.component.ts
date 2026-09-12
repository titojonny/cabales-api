import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { backspaceOutline } from 'ionicons/icons';
import { CentavosADineroPipe } from '../../pipes/centavos-a-dinero.pipe';

@Component({
  selector: 'app-money-input',
  standalone: true,
  imports: [CommonModule, IonIcon, CentavosADineroPipe],
  template: `
    <div class="money-input-container">
      <div class="display-container">
        <span class="currency-symbol">$</span>
        <span class="amount-number tabular-nums">{{ centavos() | centavosADinero: 'es-SV': '' }}</span>
      </div>

      <!-- Quick Add Buttons -->
      <div class="quick-add-row">
        <button type="button" class="quick-chip" (click)="addCents(100)">+$1</button>
        <button type="button" class="quick-chip" (click)="addCents(500)">+$5</button>
        <button type="button" class="quick-chip" (click)="addCents(1000)">+$10</button>
        <button type="button" class="quick-chip" (click)="addCents(2000)">+$20</button>
      </div>

      <!-- Virtual ATM Keypad -->
      <div class="keypad-grid">
        @for (num of [1, 2, 3, 4, 5, 6, 7, 8, 9]; track num) {
          <button type="button" class="keypad-btn" (click)="appendDigit(num)">
            {{ num }}
          </button>
        }
        <button type="button" class="keypad-btn double-zero" (click)="appendDoubleZero()">
          00
        </button>
        <button type="button" class="keypad-btn" (click)="appendDigit(0)">
          0
        </button>
        <button type="button" class="keypad-btn backspace-btn" (click)="deleteDigit()">
          <ion-icon name="backspace-outline"></ion-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .money-input-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      padding: 12px 8px;
    }

    .display-container {
      display: flex;
      align-items: baseline;
      justify-content: center;
      margin: 16px 0 20px;
      color: #F8FAFC;
    }

    .currency-symbol {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--ion-color-primary);
      margin-right: 4px;
    }

    .amount-number {
      font-size: 3.5rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.03em;
    }

    .quick-add-row {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      width: 100%;
      justify-content: center;
    }

    .quick-chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #94A3B8;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:active {
        background: var(--ion-color-primary);
        color: #000000;
        transform: scale(0.95);
      }
    }

    .keypad-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      width: 100%;
      max-width: 320px;
    }

    .keypad-btn {
      height: 56px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      color: #FFFFFF;
      font-size: 1.5rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.1s ease;
      outline: none;

      &:active {
        background: rgba(16, 185, 129, 0.2);
        border-color: var(--ion-color-primary);
        transform: scale(0.93);
      }

      &.backspace-btn {
        color: #94A3B8;
        font-size: 1.6rem;
      }

      &.double-zero {
        font-size: 1.25rem;
      }
    }
  `]
})
export class MoneyInputComponent {
  centavos = signal<number>(0);

  @Input() set initialCentavos(val: number) {
    this.centavos.set(val || 0);
  }

  @Output() centavosChange = new EventEmitter<number>();

  constructor() {
    addIcons({ backspaceOutline });
  }

  appendDigit(digit: number): void {
    const current = this.centavos();
    if (current > 9999999) return; // Limite de $99,999.99
    const updated = current * 10 + digit;
    this.centavos.set(updated);
    this.centavosChange.emit(updated);
  }

  appendDoubleZero(): void {
    const current = this.centavos();
    if (current === 0 || current > 999999) return;
    const updated = current * 100;
    this.centavos.set(updated);
    this.centavosChange.emit(updated);
  }

  deleteDigit(): void {
    const current = this.centavos();
    const updated = Math.floor(current / 10);
    this.centavos.set(updated);
    this.centavosChange.emit(updated);
  }

  addCents(extra: number): void {
    const updated = this.centavos() + extra;
    this.centavos.set(updated);
    this.centavosChange.emit(updated);
  }

  reset(): void {
    this.centavos.set(0);
    this.centavosChange.emit(0);
  }
}
