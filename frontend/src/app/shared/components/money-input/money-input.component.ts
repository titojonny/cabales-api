import { Component, Input, Output, EventEmitter, signal, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { backspaceOutline } from 'ionicons/icons';

@Component({
  selector: 'app-money-input',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <div class="money-input-container">
      <div class="display-container">
        <span class="currency-symbol">$</span>
        <span class="amount-number tabular-nums">{{ (centavos() / 100).toFixed(2) }}</span>
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
      color: #F1F1F1;
    }

    .currency-symbol {
      font-size: 2.5rem;
      font-weight: 700;
      color: #4DBE55;
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
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.4);
      color: #BEBEBE;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:active {
        background: #4DBE55;
        color: #141F14;
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
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 16px;
      color: #F1F1F1;
      font-size: 1.5rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.1s ease;
      outline: none;

      &:active {
        background: rgba(77, 190, 85, 0.2);
        border-color: #4DBE55;
        transform: scale(0.93);
      }

      &.backspace-btn {
        color: #BEBEBE;
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
    const newVal = val || 0;
    if (this.centavos() !== newVal) {
      this.centavos.set(newVal);
      this.cdr.detectChanges();
    }
  }

  @Output() centavosChange = new EventEmitter<number>();

  private zone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({ backspaceOutline });
  }

  appendDigit(digit: number): void {
    this.zone.run(() => {
      const current = this.centavos();
      if (current === 0 && digit === 0) return;
      const nextVal = current * 10 + digit;
      if (nextVal > 99999999) return;
      this.centavos.set(nextVal);
      this.centavosChange.emit(nextVal);
      this.cdr.detectChanges();
    });
  }

  appendDoubleZero(): void {
    this.zone.run(() => {
      const current = this.centavos();
      if (current === 0) return;
      const nextVal = current * 100;
      if (nextVal > 99999999) return;
      this.centavos.set(nextVal);
      this.centavosChange.emit(nextVal);
      this.cdr.detectChanges();
    });
  }

  deleteDigit(): void {
    this.zone.run(() => {
      const current = this.centavos();
      const nextVal = Math.floor(current / 10);
      this.centavos.set(nextVal);
      this.centavosChange.emit(nextVal);
      this.cdr.detectChanges();
    });
  }

  addCents(amount: number): void {
    this.zone.run(() => {
      const nextVal = this.centavos() + amount;
      if (nextVal > 99999999) return;
      this.centavos.set(nextVal);
      this.centavosChange.emit(nextVal);
      this.cdr.detectChanges();
    });
  }
}
