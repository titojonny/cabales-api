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
  ToastController,
  ViewWillEnter
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
  cashOutline,
  walletOutline,
  receiptOutline,
  warningOutline,
  sparklesOutline,
  swapHorizontalOutline,
  checkmarkDoneOutline,
  addOutline
} from 'ionicons/icons';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { AuthService } from '../../core/services/auth.service';
import { EventoDetalleDTO, ParticipanteDetalleDTO, CerrarMesaBodyDTO } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
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
        <!-- HERO CARD DE CONCILIACIÓN FINANCIERA -->
        <div class="hero-recon-card">
          <div class="hero-top-row">
            <div class="hero-event-info">
              <span class="hero-label">Radiografía de Mesa</span>
              <span class="hero-organizer">Por {{ ev.creador.nombre }} • {{ ev.fecha | date:'d MMM y' }}</span>
            </div>
            <span class="hero-comensales-pill">
              <ion-icon name="people-outline"></ion-icon>
              {{ ev.numero_comensales }} comensales
            </span>
          </div>

          <!-- Tablero de 3 Cifras Financieras -->
          <div class="fintech-metrics-grid">
            <div class="metric-block">
              <span class="metric-caption">Consumo Total</span>
              <span class="metric-value tabular-nums">{{ ev.total_gastado_centavos | centavosADinero }}</span>
            </div>
            <div class="metric-block">
              <span class="metric-caption">Abonado al Local</span>
              <span class="metric-value text-emerald tabular-nums">{{ totalPagadoCentavos() | centavosADinero }}</span>
            </div>
            <div class="metric-block">
              <span class="metric-caption">Estado Factura</span>
              @if (isFacturaCubierta()) {
                <span class="status-pill-covered">
                  <ion-icon name="checkmark-circle-outline"></ion-icon> 100% Cubierta
                </span>
              } @else if (saldoPendienteCentavos() > 0) {
                <span class="status-pill-pending">
                  <ion-icon name="warning-outline"></ion-icon> Faltan {{ saldoPendienteCentavos() | centavosADinero }}
                </span>
              } @else {
                <span class="status-pill-neutral">Sin consumos</span>
              }
            </div>
          </div>

          <!-- Barra Visual de Conciliación -->
          <div class="recon-bar-container">
            <div class="recon-bar-track">
              <div
                class="recon-bar-fill"
                [style.width.%]="porcentajeCubierto()"
                [class.bar-full]="isFacturaCubierta()"
              ></div>
            </div>
            <div class="recon-bar-labels">
              <span>{{ porcentajeCubierto() }}% cubierto ante el restaurante</span>
              <span>{{ isFacturaCubierta() ? '✓ Cuenta equilibrada' : 'Abono pendiente' }}</span>
            </div>
          </div>

          @if (ev.estado === 'CERRADO') {
            <div class="settlement-cta-banner">
              <div class="cta-info">
                <ion-icon name="shield-checkmark-outline"></ion-icon>
                <span>
                  {{ ev.esta_totalmente_saldado ? '✓ Mesa 100% saldada (Todos cabales)' : 'Mesa liquidada y saldos protegidos' }}
                </span>
              </div>
              <button class="cta-btn" (click)="goToSettlement()">
                Ver Deudas y Cobros
                <ion-icon name="arrow-forward-outline"></ion-icon>
              </button>
            </div>
          }
        </div>

        <!-- SECCIÓN DE COMENSALES Y BALANCES EN VIVO -->
        <div class="section-container">
          <div class="section-header">
            <div>
              <h2 class="section-title">Comensales & Balances</h2>
              <p class="section-subtitle">Monitorea quién debe y quién tiene saldo a favor en vivo</p>
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
            <div class="participants-grid">
              @for (p of ev.participantes; track p.id; let idx = $index) {
                <div class="participant-balance-card"
                  [class.is-debtor]="ev.estado === 'CERRADO' ? (!p.esta_saldado && (p.deuda_pendiente_centavos ?? 0) > 0) : (p.monto_consumido_centavos > p.monto_pagado_centavos)"
                  [class.is-creditor]="ev.estado === 'CERRADO' ? (!p.esta_saldado && (p.por_cobrar_pendiente_centavos ?? 0) > 0) : (p.monto_pagado_centavos > p.monto_consumido_centavos)"
                >
                  <div class="p-card-main-row">
                    <!-- Avatar & Info Izquierda -->
                    <div class="p-identity">
                      <div
                        class="p-avatar-circle"
                        [class.avatar-debt]="ev.estado === 'CERRADO' ? (!p.esta_saldado && (p.deuda_pendiente_centavos ?? 0) > 0) : (p.monto_consumido_centavos > p.monto_pagado_centavos)"
                        [class.avatar-credit]="ev.estado === 'CERRADO' ? (p.esta_saldado || (p.por_cobrar_pendiente_centavos ?? 0) > 0) : (p.monto_pagado_centavos > p.monto_consumido_centavos)"
                        [class.avatar-neutral]="ev.estado === 'CERRADO' ? p.esta_saldado : (p.monto_consumido_centavos === p.monto_pagado_centavos)"
                      >
                        {{ p.es_fantasma ? '👻' : p.nombre_visible.charAt(0).toUpperCase() }}
                      </div>
                      <div class="p-text-group">
                        <div class="p-name-row">
                          <span class="p-name">
                            @if (p.usuario_id === auth.currentUserId()) {
                              Tú ({{ p.nombre_visible }})
                            } @else {
                              {{ p.nombre_visible }}
                            }
                          </span>
                          @if (p.usuario_id === ev.creador.id) {
                            <span class="organizer-badge">Organizador</span>
                          }
                          @if (p.es_fantasma) {
                            <span class="ghost-badge">Invitado</span>
                          }
                        </div>
                        <div class="p-breakdown">
                          <span>Consumió: <strong>{{ p.monto_consumido_centavos | centavosADinero }}</strong></span>
                          <span class="bullet">•</span>
                          <span>Abonó: <strong>{{ p.monto_pagado_centavos | centavosADinero }}</strong></span>
                        </div>
                      </div>
                    </div>

                    <!-- Badge de Balance Neto a la Derecha -->
                    <div class="p-net-balance">
                      @if (ev.estado === 'CERRADO') {
                        @if (p.esta_saldado) {
                          <span class="balance-pill credit">✓ Saldado</span>
                        } @else if ((p.deuda_pendiente_centavos ?? 0) > 0) {
                          <span class="balance-pill debt">
                            🔴 Debe {{ p.deuda_pendiente_centavos | centavosADinero }}
                          </span>
                        } @else if ((p.por_cobrar_pendiente_centavos ?? 0) > 0) {
                          <span class="balance-pill credit">
                            🟢 +{{ p.por_cobrar_pendiente_centavos | centavosADinero }} a favor
                          </span>
                        } @else {
                          <span class="balance-pill credit">✓ Cabal</span>
                        }
                      } @else {
                        @if (p.monto_consumido_centavos > p.monto_pagado_centavos) {
                          <span class="balance-pill debt">
                            🔴 Debe {{ (p.monto_consumido_centavos - p.monto_pagado_centavos) | centavosADinero }}
                          </span>
                        } @else if (p.monto_pagado_centavos > p.monto_consumido_centavos) {
                          <span class="balance-pill credit">
                            🟢 +{{ (p.monto_pagado_centavos - p.monto_consumido_centavos) | centavosADinero }} a favor
                          </span>
                        } @else {
                          <span class="balance-pill neutral">
                            ⚪ Cabal ($0.00)
                          </span>
                        }
                      }
                    </div>
                  </div>

                  <!-- Fila de Acciones Rápidas del Comensal -->
                  @if (ev.estado === 'ACTIVO') {
                    <div class="p-quick-actions">
                      <button type="button" class="quick-action-btn" (click)="quickAbonoFor(p.id)">
                        <ion-icon name="card-outline"></ion-icon>
                        <span>+ Abonar</span>
                      </button>
                      <button type="button" class="quick-action-btn" (click)="quickConsumoFor(p.id)">
                        <ion-icon name="restaurant-outline"></ion-icon>
                        <span>+ Consumo</span>
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>

        <!-- BARRA FLOTANTE DE ACCIONES INFERIOR (DOCK) -->
        @if (ev.estado === 'ACTIVO') {
          <div class="floating-dock-container">
            <div class="dock-pill">
              <button class="dock-action-btn btn-consume" (click)="openConsumptionModal()">
                <ion-icon name="restaurant-outline"></ion-icon>
                <span>+ Consumo</span>
              </button>
              <button class="dock-action-btn btn-payment" (click)="openPaymentModal()">
                <ion-icon name="card-outline"></ion-icon>
                <span>+ Abono</span>
              </button>
              <button class="dock-action-btn btn-close" (click)="openCloseAssistant()">
                <ion-icon name="cash-outline"></ion-icon>
                <span>Liquidar</span>
              </button>
            </div>
          </div>
        }
      }

      <!-- MODAL: ASISTENTE DE CIERRE INTELIGENTE (SIN CIERRES EN FALSO) -->
      <ion-modal [isOpen]="isCloseAssistantOpen()" (didDismiss)="closeCloseAssistant()">
        <ng-template>
          <div class="modal-wrapper assistant-modal">
            <div class="modal-header">
              <div class="assistant-header-text">
                <h2>Liquidar y Cerrar Mesa</h2>
                <span class="assistant-sub">Asistente de conciliación y flujo de deudas</span>
              </div>
              <button class="close-btn" (click)="closeCloseAssistant()">✕</button>
            </div>

            <div class="modal-body">
              @if (saldoPendienteCentavos() > 0) {
                <!-- Caso: Faltan pagos por registrar al restaurante -->
                <div class="unsettled-notice-box">
                  <div class="notice-icon-box">
                    <ion-icon name="alert-circle-outline"></ion-icon>
                  </div>
                  <div class="notice-info">
                    <h3>Falta registrar quién pagó la cuenta</h3>
                    <p>
                      Se consumieron <strong>{{ totalConsumidoCentavos() | centavosADinero }}</strong>, pero solo se han registrado <strong>{{ totalPagadoCentavos() | centavosADinero }}</strong> abonados a la cuenta.
                      Faltan <strong>{{ saldoPendienteCentavos() | centavosADinero }}</strong> por cubrir.
                    </p>
                  </div>
                </div>

                <div class="prompt-section">
                  <span class="prompt-title">¿Quién cubrió los {{ saldoPendienteCentavos() | centavosADinero }} restantes al restaurante?</span>

                  <!-- Opción Rápida: El Organizador pagó todo -->
                  <div
                    class="assistant-choice-card"
                    [class.is-selected]="closePayerId() === organizadorParticipante()?.id"
                    (click)="closePayerId.set(organizadorParticipante()?.id || '')"
                  >
                    <div class="choice-icon">💳</div>
                    <div class="choice-text">
                      <span class="choice-heading">Yo pagué con mi tarjeta (Organizador)</span>
                      <span class="choice-desc">El sistema registrará que cubriste el saldo restante y tus amigos te deberán a ti.</span>
                    </div>
                  </div>

                  <!-- Opción: Otro Amigo Pagó la Cuenta -->
                  <div class="other-payers-section">
                    <span class="other-payers-label">O selecciona quién cubrió la cuenta con el restaurante:</span>
                    <div class="chips-container">
                      @for (p of evento()?.participantes || []; track p.id) {
                        <button
                          type="button"
                          class="person-toggle-chip"
                          [class.is-selected]="closePayerId() === p.id"
                          (click)="closePayerId.set(p.id)"
                        >
                          <span class="chip-avatar">{{ p.es_fantasma ? '👻' : p.nombre_visible.charAt(0) }}</span>
                          <span class="chip-name">
                            {{ p.usuario_id === auth.currentUserId() ? 'Yo (' + p.nombre_visible + ')' : p.nombre_visible }}
                          </span>
                        </button>
                      }
                    </div>
                  </div>
                </div>

                <div class="modal-actions">
                  <ion-button
                    expand="block"
                    color="primary"
                    shape="round"
                    [disabled]="isClosingTable() || !closePayerId()"
                    (click)="submitCloseTable()"
                  >
                    @if (isClosingTable()) {
                      <ion-spinner name="dots"></ion-spinner>
                    } @else {
                      Liquidar Mesa y Generar Deudas
                    }
                  </ion-button>
                  <button type="button" class="cancel-link-btn" (click)="closeCloseAssistant()">
                    Volver a la mesa para registrar abonos parciales
                  </button>
                </div>
              } @else {
                <!-- Caso: Factura 100% Cuadrada -->
                <div class="settled-notice-box">
                  <div class="settled-icon-box">
                    <ion-icon name="shield-checkmark-outline"></ion-icon>
                  </div>
                  <h3>¡Cuenta 100% Cubierta!</h3>
                  <p>
                    El total de la mesa ({{ totalConsumidoCentavos() | centavosADinero }}) coincide con los abonos registrados ante el restaurante.
                  </p>
                  <p class="settled-helper">
                    Al confirmar, la mesa se cerrará y el motor matemático calculará las transferencias exactas entre comensales.
                  </p>
                </div>

                <div class="modal-actions">
                  <ion-button
                    expand="block"
                    color="primary"
                    shape="round"
                    [disabled]="isClosingTable()"
                    (click)="submitCloseTable()"
                  >
                    @if (isClosingTable()) {
                      <ion-spinner name="dots"></ion-spinner>
                    } @else {
                      Confirmar y Liquidar Mesa
                    }
                  </ion-button>
                </div>
              }
            </div>
          </div>
        </ng-template>
      </ion-modal>

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

              <!-- Selector de Comensales -->
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
                      <span class="chip-name">
                        {{ p.usuario_id === auth.currentUserId() ? 'Yo (' + p.nombre_visible + ')' : p.nombre_visible }}
                      </span>
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

      <!-- MODAL: REGISTRAR ABONO / PAGO A LA FACTURA -->
      <ion-modal [isOpen]="isPaymentModalOpen()" (didDismiss)="closePaymentModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Registrar Abono a Factura</h2>
              <button class="close-btn" (click)="closePaymentModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-desc">
                ¿Quién puso dinero físico o pasó tarjeta para pagarle al restaurante?
              </p>

              <!-- Selector de comensal que abonó -->
              <div class="payer-selection-group">
                <span class="selector-title">Selecciona quién puso el dinero:</span>
                <div class="chips-container">
                  @for (p of evento()?.participantes || []; track p.id) {
                    <button
                      type="button"
                      class="person-toggle-chip"
                      [class.is-selected]="selectedPayerId() === p.id"
                      (click)="selectedPayerId.set(p.id)"
                    >
                      <span class="chip-avatar">{{ p.es_fantasma ? '👻' : p.nombre_visible.charAt(0) }}</span>
                      <span class="chip-name">
                        {{ p.usuario_id === auth.currentUserId() ? 'Yo (' + p.nombre_visible + ')' : p.nombre_visible }}
                      </span>
                    </button>
                  }
                </div>
              </div>

              <!-- ATM Keypad para monto abonado -->
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
                    Registrar Abono
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
      --background: #080C14;
      padding: 4px 12px;
    }

    .header-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.15rem;
      font-weight: 700;
      color: #F8FAFC;
    }

    .event-content {
      --background: #080C14;
      padding-bottom: 120px;
    }

    .loading-box {
      text-align: center;
      padding: 60px 20px;
      color: #94A3B8;
    }

    /* HERO CARD DE CONCILIACIÓN FINANCIERA */
    .hero-recon-card {
      background: linear-gradient(145deg, rgba(16, 185, 129, 0.12) 0%, rgba(99, 102, 241, 0.14) 50%, rgba(14, 22, 38, 0.95) 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 22px 18px;
      margin: 12px 16px 20px;
      box-shadow: 0 16px 36px -12px rgba(0, 0, 0, 0.7);
    }

    .hero-top-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .hero-event-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .hero-label {
      font-size: 0.76rem;
      color: #94A3B8;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .hero-organizer {
      font-size: 0.8rem;
      color: #CBD5E1;
    }

    .hero-comensales-pill {
      background: rgba(255, 255, 255, 0.08);
      color: #E2E8F0;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .fintech-metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1.2fr;
      gap: 10px;
      background: rgba(8, 12, 20, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .metric-block {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .metric-caption {
      font-size: 0.68rem;
      color: #94A3B8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }

    .metric-value {
      font-size: 1.15rem;
      font-weight: 800;
      color: #FFFFFF;
      line-height: 1.2;

      &.text-emerald {
        color: #34D399;
      }
    }

    .status-pill-covered {
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-pill-pending {
      background: rgba(244, 63, 94, 0.15);
      color: #FB7185;
      border: 1px solid rgba(244, 63, 94, 0.3);
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-pill-neutral {
      color: #94A3B8;
      font-size: 0.72rem;
      font-weight: 600;
    }

    .recon-bar-container {
      margin-top: 4px;
    }

    .recon-bar-track {
      height: 8px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      overflow: hidden;
      margin-bottom: 6px;
    }

    .recon-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366F1 0%, #10B981 100%);
      border-radius: 9999px;
      transition: width 0.4s ease;

      &.bar-full {
        background: #10B981;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
      }
    }

    .recon-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #94A3B8;
      font-weight: 500;
    }

    .settlement-cta-banner {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .cta-info {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #34D399;
      font-size: 0.82rem;
      font-weight: 600;
    }

    .cta-btn {
      background: var(--ion-color-primary);
      color: #064E3B;
      border: none;
      padding: 8px 14px;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    /* SECCIÓN DE COMENSALES */
    .section-container {
      padding: 0 16px 140px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 14px;
    }

    .section-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.2rem;
      font-weight: 700;
      color: #F8FAFC;
      margin: 0;
    }

    .section-subtitle {
      font-size: 0.78rem;
      color: #64748B;
      margin: 2px 0 0;
    }

    .small-add-btn {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818CF8;
      font-size: 0.76rem;
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
      padding: 40px 20px;
      background: #0E1626;
      border-radius: 20px;
      border: 1px dashed rgba(255, 255, 255, 0.1);
      color: #94A3B8;
      font-size: 0.9rem;
    }

    .participants-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .participant-balance-card {
      background: #0E1626;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 18px;
      padding: 14px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      transition: transform 0.15s ease, border-color 0.2s ease;

      &.is-debtor {
        border-color: rgba(244, 63, 94, 0.22);
      }

      &.is-creditor {
        border-color: rgba(16, 185, 129, 0.22);
      }
    }

    .p-card-main-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .p-identity {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .p-avatar-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.1rem;
      flex-shrink: 0;

      &.avatar-debt {
        background: rgba(244, 63, 94, 0.15);
        color: #FB7185;
        border: 2px solid rgba(244, 63, 94, 0.3);
      }

      &.avatar-credit {
        background: rgba(16, 185, 129, 0.15);
        color: #34D399;
        border: 2px solid rgba(16, 185, 129, 0.3);
      }

      &.avatar-neutral {
        background: rgba(148, 163, 184, 0.15);
        color: #94A3B8;
        border: 2px solid rgba(148, 163, 184, 0.3);
      }
    }

    .p-text-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .p-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .p-name {
      font-weight: 700;
      color: #F8FAFC;
      font-size: 0.96rem;
    }

    .organizer-badge {
      font-size: 0.65rem;
      font-weight: 700;
      color: #818CF8;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.25);
      padding: 1px 6px;
      border-radius: 9999px;
    }

    .ghost-badge {
      font-size: 0.65rem;
      font-weight: 600;
      color: #94A3B8;
      background: rgba(255, 255, 255, 0.06);
      padding: 1px 6px;
      border-radius: 9999px;
    }

    .p-breakdown {
      font-size: 0.74rem;
      color: #94A3B8;
      display: flex;
      align-items: center;
      gap: 5px;

      strong {
        color: #E2E8F0;
      }

      .bullet {
        color: #475569;
      }
    }

    .p-net-balance {
      flex-shrink: 0;
    }

    .p-quick-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .quick-action-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #CBD5E1;
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 0.72rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      transition: background 0.15s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #FFFFFF;
      }
    }

    /* DOCK FLOTANTE INFERIOR */
    .floating-dock-container {
      position: fixed;
      bottom: 24px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      z-index: 1000;
      pointer-events: none;
    }

    .dock-pill {
      pointer-events: auto;
      background: rgba(14, 22, 38, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
      padding: 6px;
      display: flex;
      gap: 8px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(16, 185, 129, 0.12);
    }

    .dock-action-btn {
      border: none;
      border-radius: 9999px;
      padding: 10px 18px;
      font-size: 0.84rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: transform 0.15s ease, background 0.2s ease;

      &:active {
        transform: scale(0.96);
      }

      &.btn-consume {
        background: rgba(255, 255, 255, 0.07);
        color: #F8FAFC;

        &:hover {
          background: rgba(255, 255, 255, 0.12);
        }
      }

      &.btn-payment {
        background: rgba(99, 102, 241, 0.2);
        color: #A5B4FC;
        border: 1px solid rgba(99, 102, 241, 0.35);

        &:hover {
          background: rgba(99, 102, 241, 0.3);
        }
      }

      &.btn-close {
        background: linear-gradient(135deg, #10B981 0%, #059669 100%);
        color: #FFFFFF;
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
      }
    }

    /* ESTILOS DE MODALES */
    .modal-wrapper {
      background: #0E1626;
      height: 100%;
      padding: 24px 20px;
      color: #F8FAFC;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;

      h2 {
        margin: 0;
        font-family: 'Outfit', sans-serif;
        font-size: 1.3rem;
        font-weight: 800;
      }
    }

    .assistant-header-text {
      h2 {
        margin: 0;
        font-family: 'Outfit', sans-serif;
        font-size: 1.3rem;
        font-weight: 800;
      }

      .assistant-sub {
        font-size: 0.78rem;
        color: #94A3B8;
        display: block;
        margin-top: 3px;
      }
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.08);
      border: none;
      color: #CBD5E1;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 1rem;
      cursor: pointer;
    }

    .modal-body {
      flex: 1;
    }

    .modal-desc {
      font-size: 0.85rem;
      color: #94A3B8;
      margin-bottom: 18px;
    }

    .input-hint {
      font-size: 0.8rem;
      color: #94A3B8;
      margin-bottom: 14px;
    }

    .participant-form-body {
      margin-top: 18px;
    }

    /* ASISTENTE DE CIERRE BOXES */
    .unsettled-notice-box {
      background: rgba(244, 63, 94, 0.1);
      border: 1px solid rgba(244, 63, 94, 0.25);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .notice-icon-box {
      color: #FB7185;
      font-size: 1.8rem;
      line-height: 1;
    }

    .notice-info {
      h3 {
        margin: 0 0 4px;
        font-size: 0.95rem;
        font-weight: 700;
        color: #FDA4AF;
      }

      p {
        margin: 0;
        font-size: 0.82rem;
        color: #CBD5E1;
        line-height: 1.4;

        strong {
          color: #FFFFFF;
        }
      }
    }

    .settled-notice-box {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 20px;
      padding: 24px 18px;
      text-align: center;
      margin-bottom: 24px;

      ion-icon {
        font-size: 2.5rem;
        color: #34D399;
        margin-bottom: 8px;
      }

      h3 {
        margin: 0 0 8px;
        font-size: 1.2rem;
        font-weight: 800;
        color: #F8FAFC;
      }

      p {
        margin: 0;
        font-size: 0.85rem;
        color: #CBD5E1;
        line-height: 1.4;
      }

      .settled-helper {
        margin-top: 10px;
        color: #94A3B8;
        font-size: 0.78rem;
      }
    }

    .prompt-section {
      margin-bottom: 24px;
    }

    .prompt-title {
      display: block;
      font-size: 0.88rem;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 12px;
    }

    .assistant-choice-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 14px;
      display: flex;
      gap: 12px;
      align-items: center;
      cursor: pointer;
      width: 100%;
      text-align: left;
      margin-bottom: 16px;
      transition: all 0.2s ease;

      &.is-selected {
        background: rgba(16, 185, 129, 0.14);
        border-color: #10B981;
        box-shadow: 0 0 16px rgba(16, 185, 129, 0.2);
      }
    }

    .choice-icon {
      font-size: 1.6rem;
    }

    .choice-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .choice-heading {
      font-size: 0.9rem;
      font-weight: 700;
      color: #FFFFFF;
    }

    .choice-desc {
      font-size: 0.76rem;
      color: #94A3B8;
      line-height: 1.3;
    }

    .other-payers-section {
      margin-top: 14px;
    }

    .other-payers-label {
      font-size: 0.78rem;
      color: #94A3B8;
      margin-bottom: 8px;
      display: block;
    }

    .cancel-link-btn {
      background: none;
      border: none;
      color: #94A3B8;
      font-size: 0.8rem;
      font-weight: 600;
      margin-top: 12px;
      width: 100%;
      text-align: center;
      cursor: pointer;
      padding: 8px;

      &:hover {
        color: #F8FAFC;
      }
    }

    /* CHIPS Y SELECTORES */
    .participants-selector-section, .payer-selection-group {
      margin-top: 16px;
      margin-bottom: 20px;
    }

    .selector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .selector-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #CBD5E1;
      display: block;
      margin-bottom: 8px;
    }

    .toggle-all-btn {
      background: none;
      border: none;
      color: #818CF8;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .person-toggle-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: #CBD5E1;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;

      &.is-selected {
        background: rgba(16, 185, 129, 0.18);
        border-color: #10B981;
        color: #34D399;
        font-weight: 700;
      }
    }

    .split-preview-banner {
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 0.82rem;
      color: #C7D2FE;
      margin-top: 14px;
      text-align: center;

      strong {
        color: #FFFFFF;
      }
    }

    .modal-actions {
      margin-top: 20px;
      padding-bottom: 24px;
    }
  `]
})
export class EventDetailPage implements OnInit, ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(CabalesApiService);
  readonly auth = inject(AuthService);
  private toastCtrl = inject(ToastController);

  eventId = signal<string>('');
  evento = signal<EventoDetalleDTO | null>(null);
  isLoading = signal<boolean>(true);

  // Computados Financieros
  totalConsumidoCentavos = computed(() => this.evento()?.total_gastado_centavos || 0);

  totalPagadoCentavos = computed(() => {
    const parts = this.evento()?.participantes || [];
    return parts.reduce((acc, p) => acc + (p.monto_pagado_centavos || 0), 0);
  });

  saldoPendienteCentavos = computed(() => {
    const consumido = this.totalConsumidoCentavos();
    const pagado = this.totalPagadoCentavos();
    return Math.max(0, consumido - pagado);
  });

  porcentajeCubierto = computed(() => {
    const consumido = this.totalConsumidoCentavos();
    if (!consumido || consumido <= 0) return 100;
    const pagado = this.totalPagadoCentavos();
    return Math.min(100, Math.round((pagado / consumido) * 100));
  });

  isFacturaCubierta = computed(() => {
    return this.saldoPendienteCentavos() === 0 && this.totalConsumidoCentavos() > 0;
  });

  organizadorParticipante = computed(() => {
    const ev = this.evento();
    if (!ev) return null;
    return ev.participantes.find((p) => p.usuario_id === ev.creador.id) || null;
  });

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

  // Asistente Inteligente de Cierre de Mesa
  isCloseAssistantOpen = signal<boolean>(false);
  closePayerId = signal<string>('');
  isClosingTable = signal<boolean>(false);

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
      cashOutline,
      walletOutline,
      receiptOutline,
      warningOutline,
      sparklesOutline,
      swapHorizontalOutline,
      checkmarkDoneOutline,
      addOutline
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.eventId.set(id);
      this.loadEvent();
    }
  }

  ionViewWillEnter(): void {
    if (this.eventId()) {
      this.loadEvent();
    }
  }

  loadEvent(): void {
    const id = this.eventId();
    if (!id) return;

    this.isLoading.set(true);
    this.api.obtenerDetalleEvento(id).subscribe({
      next: (data) => {
        // Si el creador no está sentado en la mesa y la mesa sigue ACTIVA, sentarlo automáticamente
        const hasCreatorSeated = data.participantes.some((p) => p.usuario_id === data.creador.id);
        if (!hasCreatorSeated && data.estado === 'ACTIVO') {
          this.api.agregarParticipante(id, { usuario_id: data.creador.id }).subscribe({
            next: () => {
              this.loadEvent();
            },
            error: () => {
              this.evento.set(data);
              this.isLoading.set(false);
            }
          });
          return;
        }

        this.evento.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
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
    const allIds = (this.evento()?.participantes || []).map((p) => p.id);
    this.selectedParticipantIds.set(allIds);
    this.isConsumptionModalOpen.set(true);
  }

  closeConsumptionModal(): void {
    this.isConsumptionModalOpen.set(false);
  }

  quickConsumoFor(participanteId: string): void {
    this.consumptionDesc.set('');
    this.consumptionCentavos.set(0);
    this.selectedParticipantIds.set([participanteId]);
    this.isConsumptionModalOpen.set(true);
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

  // --- ABONOS / PAGOS ---

  openPaymentModal(): void {
    this.paymentCentavos.set(0);
    const participants = this.evento()?.participantes || [];
    this.selectedPayerId.set(participants[0]?.id || '');
    this.isPaymentModalOpen.set(true);
  }

  closePaymentModal(): void {
    this.isPaymentModalOpen.set(false);
  }

  quickAbonoFor(participanteId: string): void {
    this.selectedPayerId.set(participanteId);
    const p = (this.evento()?.participantes || []).find((x) => x.id === participanteId);
    if (p) {
      const deuda = p.monto_consumido_centavos - p.monto_pagado_centavos;
      this.paymentCentavos.set(deuda > 0 ? deuda : 0);
    } else {
      this.paymentCentavos.set(0);
    }
    this.isPaymentModalOpen.set(true);
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

  // --- ASISTENTE INTELIGENTE DE CIERRE DE MESA ---

  openCloseAssistant(): void {
    if (this.evento()?.estado === 'CERRADO') {
      this.goToSettlement();
      return;
    }
    const org = this.organizadorParticipante();
    const first = this.evento()?.participantes?.[0];
    const defaultPayer = org ? org.id : (first ? first.id : '');
    this.closePayerId.set(defaultPayer);
    this.isCloseAssistantOpen.set(true);
  }

  closeCloseAssistant(): void {
    this.isCloseAssistantOpen.set(false);
  }

  submitCloseTable(): void {
    const saldo = this.saldoPendienteCentavos();
    const body: CerrarMesaBodyDTO = {};
    if (saldo > 0) {
      const payerId = this.closePayerId();
      if (!payerId) {
        this.toastCtrl.create({
          message: 'Selecciona quién cubrió el saldo restante.',
          duration: 3000,
          color: 'warning'
        }).then(t => t.present());
        return;
      }
      body.pagador_restante_id = payerId;
    }

    this.isClosingTable.set(true);
    this.api.cerrarEvento(this.eventId(), body).subscribe({
      next: () => {
        this.isClosingTable.set(false);
        this.closeCloseAssistant();
        this.toastCtrl.create({
          message: '¡Mesa liquidada con éxito! Deudas calculadas.',
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
        setTimeout(() => {
          this.goToSettlement();
        }, 180);
      },
      error: (err) => {
        this.isClosingTable.set(false);
        const msg = err?.error?.message || 'Error al liquidar la mesa';
        this.toastCtrl.create({
          message: msg,
          duration: 4000,
          color: 'danger'
        }).then(t => t.present());
      }
    });
  }
}
