import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonButton,
  IonIcon,
  IonSpinner,
  IonModal,
  IonItem,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  AlertController,
  ToastController
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  peopleOutline,
  personAddOutline,
  restaurantOutline,
  cardOutline,
  checkmarkCircleOutline,
  lockClosedOutline,
  timeOutline,
  shieldCheckmarkOutline,
  arrowForwardOutline,
  alertCircleOutline,
  cashOutline
} from 'ionicons/icons';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { AuthService } from '../../core/services/auth.service';
import { EventoDetalleDTO, ParticipanteDetalleDTO } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { ParticipantBadgeComponent } from '../../shared/components/participant-badge/participant-badge.component';
import { MoneyInputComponent } from '../../shared/components/money-input/money-input.component';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonButton,
    IonIcon,
    IonSpinner,
    IonModal,
    IonItem,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    CentavosADineroPipe,
    StatusBadgeComponent,
    ParticipantBadgeComponent,
    MoneyInputComponent
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="cabales-toolbar">
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/events" text="" color="light"></ion-back-button>
        </ion-buttons>
        <ion-title class="header-title">{{ evento()?.nombre || 'Detalle de Mesa' }}</ion-title>
        <ion-buttons slot="end">
          @if (evento()?.estado) {
            <app-status-badge [status]="evento()!.estado"></app-status-badge>
          }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="event-content" [fullscreen]="true">
      @if (isLoading()) {
        <div class="loading-box">
          <ion-spinner name="crescent" color="primary"></ion-spinner>
          <p>Cargando radiografía de la mesa...</p>
        </div>
      } @else if (evento(); as ev) {
        <!-- Hero Bill Card -->
        <div class="hero-mesa-card">
          <div class="hero-top-row">
            <span class="hero-label">Total Consumido en la Mesa</span>
            <span class="hero-comensales-pill">
              <ion-icon name="people-outline"></ion-icon>
              {{ ev.numero_comensales }} comensales
            </span>
          </div>
          <div class="hero-amount tabular-nums">
            {{ ev.total_gastado_centavos | centavosADinero }}
          </div>
          <div class="hero-footer-row">
            <span class="hero-organizer">Organizado por {{ ev.creador.nombre }}</span>
            <span class="hero-date">{{ ev.fecha | date:'d MMMM, y' }}</span>
          </div>

          @if (ev.estado === 'CERRADO') {
            <div class="settlement-cta-banner">
              <div class="cta-info">
                <ion-icon name="shield-checkmark-outline"></ion-icon>
                <span>Mesa liquidada y protegida</span>
              </div>
              <button class="cta-btn" (click)="goToSettlement()">
                Ver Deudas y Cobros
                <ion-icon name="arrow-forward-outline"></ion-icon>
              </button>
            </div>
          }
        </div>

        <!-- Radiografía de Consumo (Ranking) -->
        <div class="section-container">
          <div class="section-header">
            <div>
              <h2 class="section-title">Radiografía de Consumo</h2>
              <p class="section-subtitle">Quién consumió más en la mesa (orden descendente)</p>
            </div>
            @if (ev.estado === 'ACTIVO') {
              <button class="small-add-btn" (click)="openAddParticipantModal()">
                <ion-icon name="person-add-outline"></ion-icon>
                <span>+ Comensal</span>
              </button>
            }
          </div>

          @if (ev.participantes.length === 0) {
            <div class="empty-table-box">
              <p>Aún no has sentado a nadie en la mesa.</p>
              <ion-button color="primary" fill="outline" shape="round" (click)="openAddParticipantModal()">
                + Agregar Comensales
              </ion-button>
            </div>
          } @else {
            <div class="participants-list">
              @for (p of ev.participantes; track p.id; let idx = $index) {
                <div class="participant-card">
                  <div class="p-card-header">
                    <div class="p-info-left">
                      <span class="p-rank">#{{ idx + 1 }}</span>
                      <app-participant-badge
                        [name]="p.nombre_visible"
                        [isGhost]="p.es_fantasma"
                      ></app-participant-badge>
                    </div>
                    <div class="p-amounts-right">
                      <span class="p-consumed tabular-nums">
                        {{ p.monto_consumido_centavos | centavosADinero }}
                      </span>
                      @if (p.monto_pagado_centavos > 0) {
                        <span class="p-paid tabular-nums">
                          Puso: {{ p.monto_pagado_centavos | centavosADinero }}
                        </span>
                      }
                    </div>
                  </div>

                  <!-- Visual Progress Bar -->
                  <div class="progress-container">
                    <div
                      class="progress-bar-fill"
                      [style.width.%]="getConsumptionPercentage(p.monto_consumido_centavos, ev.total_gastado_centavos)"
                    ></div>
                  </div>
                  <div class="progress-label">
                    <span>{{ getConsumptionPercentage(p.monto_consumido_centavos, ev.total_gastado_centavos) }}% del total</span>
                    @if (p.monto_pagado_centavos > 0) {
                      <span class="paid-indicator">✓ Pago registrado</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Bottom Action Floating Bar for Open Events -->
        @if (ev.estado === 'ACTIVO') {
          <div class="bottom-action-bar">
            <div class="action-buttons-row">
              <button class="action-btn btn-secondary" (click)="openConsumptionModal()">
                <ion-icon name="restaurant-outline"></ion-icon>
                <span>+ Consumo</span>
              </button>
              <button class="action-btn btn-secondary" (click)="openPaymentModal()">
                <ion-icon name="card-outline"></ion-icon>
                <span>+ Pago</span>
              </button>
              <button class="action-btn btn-primary" (click)="confirmCloseTable()">
                <ion-icon name="cash-outline"></ion-icon>
                <span>Liquidar</span>
              </button>
            </div>
          </div>
        }
      }

      <!-- MODAL: AGREGAR COMENSAL -->
      <ion-modal [isOpen]="isAddParticipantModalOpen()" (didDismiss)="closeAddParticipantModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Sentar a la Mesa</h2>
              <button class="close-btn" (click)="closeAddParticipantModal()">✕</button>
            </div>
            <div class="modal-body">
              <ion-segment [value]="participantType()" (ionChange)="onParticipantTypeChange($event.detail.value)" mode="ios">
                <ion-segment-button value="GHOST">
                  <ion-label>👻 Invitado (Sin app)</ion-label>
                </ion-segment-button>
                <ion-segment-button value="USER">
                  <ion-label>👤 Con Cuenta</ion-label>
                </ion-segment-button>
              </ion-segment>

              <div class="participant-form-body">
                @if (participantType() === 'GHOST') {
                  <p class="input-hint">
                    Anota a tu amigo por su apodo o nombre. No necesita registrarse ni descargar nada.
                  </p>
                  <ion-item class="cabales-input-item" lines="none">
                    <ion-input
                      label="Nombre o apodo"
                      labelPlacement="stacked"
                      placeholder="Ej. Chele, Gaby, El Primo"
                      [value]="guestName()"
                      (ionInput)="guestName.set($any($event.target).value)"
                    ></ion-input>
                  </ion-item>
                } @else {
                  <p class="input-hint">
                    Ingresa el UUID del usuario registrado para que el evento aparezca en su propio celular.
                  </p>
                  <ion-item class="cabales-input-item" lines="none">
                    <ion-input
                      label="ID de Usuario registrado"
                      labelPlacement="stacked"
                      placeholder="UUID del usuario"
                      [value]="registeredUserId()"
                      (ionInput)="registeredUserId.set($any($event.target).value)"
                    ></ion-input>
                  </ion-item>
                }

                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSavingParticipant() || (participantType() === 'GHOST' ? !guestName().trim() : !registeredUserId().trim())"
                  (click)="submitAddParticipant()"
                >
                  @if (isSavingParticipant()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    Sentar Comensal
                  }
                </ion-button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>

      <!-- MODAL: REGISTRAR CONSUMO -->
      <ion-modal [isOpen]="isConsumptionModalOpen()" (didDismiss)="closeConsumptionModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Registrar Consumo</h2>
              <button class="close-btn" (click)="closeConsumptionModal()">✕</button>
            </div>
            <div class="modal-body">
              <ion-item class="cabales-input-item" lines="none">
                <ion-input
                  label="Descripción (opcional)"
                  labelPlacement="stacked"
                  placeholder="Ej. Ronda de micheladas, Nachos"
                  [value]="consumptionDesc()"
                  (ionInput)="consumptionDesc.set($any($event.target).value)"
                ></ion-input>
              </ion-item>

              <!-- ATM Money Keypad -->
              <app-money-input
                [initialCentavos]="consumptionCentavos()"
                (centavosChange)="consumptionCentavos.set($event)"
              ></app-money-input>

              <!-- Participant Selection Chips -->
              <div class="participants-selector-section">
                <div class="selector-header">
                  <span class="selector-title">¿Quiénes consumieron de esto?</span>
                  <button type="button" class="toggle-all-btn" (click)="toggleAllParticipants()">
                    {{ areAllSelected() ? 'Desmarcar todos' : 'Todos' }}
                  </button>
                </div>

                <div class="chips-container">
                  @for (p of evento()?.participantes || []; track p.id) {
                    <button
                      type="button"
                      class="person-toggle-chip"
                      [class.is-selected]="selectedParticipantIds().includes(p.id)"
                      (click)="toggleParticipant(p.id)"
                    >
                      <span class="chip-avatar">{{ p.es_fantasma ? '👻' : p.nombre_visible.charAt(0) }}</span>
                      <span class="chip-name">{{ p.nombre_visible }}</span>
                    </button>
                  }
                </div>

                @if (selectedParticipantIds().length > 0 && consumptionCentavos() > 0) {
                  <div class="split-preview-banner">
                    A cada comensal le tocarán:
                    <strong>{{ (consumptionCentavos() / selectedParticipantIds().length) | centavosADinero }}</strong>
                  </div>
                }
              </div>

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSavingConsumption() || consumptionCentavos() <= 0 || selectedParticipantIds().length === 0"
                  (click)="submitConsumption()"
                >
                  @if (isSavingConsumption()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    Guardar Consumo en Centavos
                  }
                </ion-button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>

      <!-- MODAL: REGISTRAR PAGO -->
      <ion-modal [isOpen]="isPaymentModalOpen()" (didDismiss)="closePaymentModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Registrar Pago a Factura</h2>
              <button class="close-btn" (click)="closePaymentModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-desc">
                ¿Quién puso dinero físico o pasó tarjeta para pagarle al restaurante?
              </p>

              <!-- Selector de comensal que pagó -->
              <div class="payer-selection-group">
                <span class="selector-title">Selecciona quién pagó:</span>
                <div class="chips-container">
                  @for (p of evento()?.participantes || []; track p.id) {
                    <button
                      type="button"
                      class="person-toggle-chip"
                      [class.is-selected]="selectedPayerId() === p.id"
                      (click)="selectedPayerId.set(p.id)"
                    >
                      <span class="chip-avatar">{{ p.es_fantasma ? '👻' : p.nombre_visible.charAt(0) }}</span>
                      <span class="chip-name">{{ p.nombre_visible }}</span>
                    </button>
                  }
                </div>
              </div>

              <!-- ATM Keypad para monto pagado -->
              <app-money-input
                [initialCentavos]="paymentCentavos()"
                (centavosChange)="paymentCentavos.set($event)"
              ></app-money-input>

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSavingPayment() || paymentCentavos() <= 0 || !selectedPayerId()"
                  (click)="submitPayment()"
                >
                  @if (isSavingPayment()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    Registrar Pago
                  }
                </ion-button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    .cabales-toolbar {
      --background: #0B0F19;
      padding: 4px 12px;
    }

    .header-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.15rem;
      font-weight: 700;
      color: #F8FAFC;
    }

    .event-content {
      --background: #0B0F19;
      padding-bottom: 120px;
    }

    .loading-box {
      text-align: center;
      padding: 60px 20px;
      color: #94A3B8;
    }

    .hero-mesa-card {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(99, 102, 241, 0.16) 100%);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 24px;
      padding: 24px 20px;
      margin: 12px 16px 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .hero-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .hero-label {
      font-size: 0.82rem;
      color: #94A3B8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .hero-comensales-pill {
      background: rgba(255, 255, 255, 0.08);
      color: #E2E8F0;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .hero-amount {
      font-size: 3.2rem;
      font-weight: 800;
      color: #FFFFFF;
      line-height: 1.1;
      margin: 6px 0 10px;
      letter-spacing: -0.03em;
    }

    .hero-footer-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
      color: #94A3B8;
    }

    .settlement-cta-banner {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .cta-info {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #34D399;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .cta-btn {
      background: var(--ion-color-primary);
      color: #064E3B;
      border: none;
      padding: 8px 14px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .section-container {
      padding: 0 16px 120px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .section-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 700;
      color: #F8FAFC;
      margin: 0;
    }

    .section-subtitle {
      font-size: 0.8rem;
      color: #64748B;
      margin: 2px 0 0;
    }

    .small-add-btn {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818CF8;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 6px 12px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    .empty-table-box {
      text-align: center;
      padding: 30px 20px;
      background: #151D30;
      border-radius: 20px;
      color: #94A3B8;
    }

    .participants-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .participant-card {
      background: #151D30;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 18px;
      padding: 16px;
    }

    .p-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .p-info-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .p-rank {
      font-family: 'Outfit', sans-serif;
      font-size: 0.9rem;
      font-weight: 800;
      color: #64748B;
      width: 22px;
    }

    .p-amounts-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .p-consumed {
      font-size: 1.15rem;
      font-weight: 700;
      color: #F8FAFC;
    }

    .p-paid {
      font-size: 0.75rem;
      font-weight: 600;
      color: #34D399;
    }

    .progress-container {
      height: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      overflow: hidden;
      margin-bottom: 6px;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #10B981 0%, #6366F1 100%);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #64748B;
    }

    .paid-indicator {
      color: #10B981;
      font-weight: 600;
    }

    .bottom-action-bar {
      position: fixed;
      bottom: 20px;
      left: 16px;
      right: 16px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 8px;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6);
      z-index: 999;
    }

    .action-buttons-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1.2fr;
      gap: 8px;
    }

    .action-btn {
      border: none;
      height: 48px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;

      &:active {
        transform: scale(0.96);
      }

      &.btn-secondary {
        background: rgba(255, 255, 255, 0.06);
        color: #F8FAFC;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      &.btn-primary {
        background: linear-gradient(135deg, #10B981 0%, #059669 100%);
        color: #064E3B;
        box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
      }
    }

    /* Modals */
    .modal-wrapper {
      background: #151D30;
      padding: 24px;
      height: 100%;
      color: #F8FAFC;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;

      h2 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.35rem;
        font-weight: 800;
        margin: 0;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: #94A3B8;
        font-size: 1.2rem;
        cursor: pointer;
      }
    }

    .modal-desc {
      color: #94A3B8;
      font-size: 0.85rem;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .input-hint {
      font-size: 0.82rem;
      color: #94A3B8;
      margin: 14px 0 10px;
    }

    .participant-form-body {
      margin-top: 16px;
    }

    .selector-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #E2E8F0;
    }

    .selector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .toggle-all-btn {
      background: transparent;
      border: none;
      color: var(--ion-color-primary);
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .person-toggle-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.15s ease;

      .chip-avatar {
        font-size: 0.85rem;
        font-weight: 700;
      }

      .chip-name {
        font-size: 0.82rem;
        color: #94A3B8;
      }

      &.is-selected {
        background: rgba(16, 185, 129, 0.2);
        border-color: var(--ion-color-primary);

        .chip-name {
          color: #34D399;
          font-weight: 700;
        }
      }
    }

    .split-preview-banner {
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 0.85rem;
      color: #C7D2FE;
      margin-bottom: 20px;
      text-align: center;

      strong {
        color: #FFFFFF;
      }
    }

    .payer-selection-group {
      margin-bottom: 16px;
    }

    .modal-actions {
      margin-top: 20px;
      padding-bottom: 30px;
    }
  `]
})
export class EventDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(CabalesApiService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  eventId = signal<string>('');
  evento = signal<EventoDetalleDTO | null>(null);
  isLoading = signal<boolean>(true);

  // Modales
  isAddParticipantModalOpen = signal<boolean>(false);
  participantType = signal<'GHOST' | 'USER'>('GHOST');
  guestName = signal<string>('');
  registeredUserId = signal<string>('');
  isSavingParticipant = signal<boolean>(false);

  isConsumptionModalOpen = signal<boolean>(false);
  consumptionDesc = signal<string>('');
  consumptionCentavos = signal<number>(0);
  selectedParticipantIds = signal<string[]>([]);
  isSavingConsumption = signal<boolean>(false);

  isPaymentModalOpen = signal<boolean>(false);
  selectedPayerId = signal<string>('');
  paymentCentavos = signal<number>(0);
  isSavingPayment = signal<boolean>(false);

  areAllSelected = computed(() => {
    const all = this.evento()?.participantes || [];
    return all.length > 0 && this.selectedParticipantIds().length === all.length;
  });

  constructor() {
    addIcons({
      peopleOutline,
      personAddOutline,
      restaurantOutline,
      cardOutline,
      checkmarkCircleOutline,
      lockClosedOutline,
      timeOutline,
      shieldCheckmarkOutline,
      arrowForwardOutline,
      alertCircleOutline,
      cashOutline
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.eventId.set(id);
      this.loadEvent();
    }
  }

  loadEvent(): void {
    const id = this.eventId();
    if (!id) return;

    this.isLoading.set(true);
    this.api.obtenerDetalleEvento(id).subscribe({
      next: (data) => {
        this.evento.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  getConsumptionPercentage(consumedCentavos: number, totalCentavos: number): number {
    if (!totalCentavos || totalCentavos <= 0) return 0;
    return Math.round((consumedCentavos / totalCentavos) * 100);
  }

  goToSettlement(): void {
    this.router.navigate(['/events', this.eventId(), 'settlement']);
  }

  onParticipantTypeChange(val: any): void {
    if (val === 'GHOST' || val === 'USER') {
      this.participantType.set(val);
    }
  }

  // --- PARTICIPANTES ---

  openAddParticipantModal(): void {
    this.guestName.set('');
    this.registeredUserId.set('');
    this.participantType.set('GHOST');
    this.isAddParticipantModalOpen.set(true);
  }

  closeAddParticipantModal(): void {
    this.isAddParticipantModalOpen.set(false);
  }

  submitAddParticipant(): void {
    const isGhost = this.participantType() === 'GHOST';
    const body = isGhost
      ? { nombre_invitado: this.guestName().trim() }
      : { usuario_id: this.registeredUserId().trim() };

    this.isSavingParticipant.set(true);
    this.api.agregarParticipante(this.eventId(), body).subscribe({
      next: () => {
        this.isSavingParticipant.set(false);
        this.closeAddParticipantModal();
        this.loadEvent();
      },
      error: () => {
        this.isSavingParticipant.set(false);
      }
    });
  }

  // --- CONSUMOS ---

  openConsumptionModal(): void {
    this.consumptionDesc.set('');
    this.consumptionCentavos.set(0);
    // Por defecto seleccionar a todos los participantes
    const allIds = (this.evento()?.participantes || []).map((p) => p.id);
    this.selectedParticipantIds.set(allIds);
    this.isConsumptionModalOpen.set(true);
  }

  closeConsumptionModal(): void {
    this.isConsumptionModalOpen.set(false);
  }

  toggleParticipant(id: string): void {
    const current = this.selectedParticipantIds();
    if (current.includes(id)) {
      this.selectedParticipantIds.set(current.filter((item) => item !== id));
    } else {
      this.selectedParticipantIds.set([...current, id]);
    }
  }

  toggleAllParticipants(): void {
    if (this.areAllSelected()) {
      this.selectedParticipantIds.set([]);
    } else {
      const allIds = (this.evento()?.participantes || []).map((p) => p.id);
      this.selectedParticipantIds.set(allIds);
    }
  }

  submitConsumption(): void {
    const monto = this.consumptionCentavos();
    const ids = this.selectedParticipantIds();
    if (monto <= 0 || ids.length === 0) return;

    this.isSavingConsumption.set(true);
    this.api.registrarConsumo(this.eventId(), {
      monto_centavos: monto,
      participante_ids: ids,
      descripcion: this.consumptionDesc().trim() || undefined
    }).subscribe({
      next: () => {
        this.isSavingConsumption.set(false);
        this.closeConsumptionModal();
        this.loadEvent();
      },
      error: () => {
        this.isSavingConsumption.set(false);
      }
    });
  }

  // --- PAGOS ---

  openPaymentModal(): void {
    this.paymentCentavos.set(0);
    const participants = this.evento()?.participantes || [];
    this.selectedPayerId.set(participants[0]?.id || '');
    this.isPaymentModalOpen.set(true);
  }

  closePaymentModal(): void {
    this.isPaymentModalOpen.set(false);
  }

  submitPayment(): void {
    const monto = this.paymentCentavos();
    const payerId = this.selectedPayerId();
    if (monto <= 0 || !payerId) return;

    this.isSavingPayment.set(true);
    this.api.registrarPago(this.eventId(), {
      monto_centavos: monto,
      participante_id: payerId
    }).subscribe({
      next: () => {
        this.isSavingPayment.set(false);
        this.closePaymentModal();
        this.loadEvent();
      },
      error: () => {
        this.isSavingPayment.set(false);
      }
    });
  }

  // --- CIERRE DE MESA ---

  async confirmCloseTable(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: '¿Liquidar y Cerrar Mesa?',
      subHeader: 'Esta acción bloqueará la mesa y calculará el flujo mínimo de deudas.',
      message: 'Nadie podrá agregar más consumos ni comensales a partir de este momento.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Sí, Liquidar Mesa',
          role: 'confirm',
          handler: () => {
            this.executeCloseTable();
          }
        }
      ]
    });

    await alert.present();
  }

  private executeCloseTable(): void {
    this.isLoading.set(true);
    this.api.cerrarEvento(this.eventId()).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.toastCtrl.create({
          message: '¡Mesa liquidada con éxito!',
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
        this.goToSettlement();
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }
}
