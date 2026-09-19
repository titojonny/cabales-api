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
  addOutline,
  createOutline,
  trashOutline,
  pricetagOutline,
  qrCodeOutline,
  shareSocialOutline,
  copyOutline,
  logoWhatsapp,
  linkOutline,
  arrowBackOutline
} from 'ionicons/icons';
import QRCode from 'qrcode';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { AuthService } from '../../core/services/auth.service';
import { EventoDetalleDTO, ParticipanteDetalleDTO, CerrarMesaBodyDTO, ConsumoDTO } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { MoneyInputComponent } from '../../shared/components/money-input/money-input.component';
import { compartirTexto, copiarTextoAlPortapapeles, generarMensajeInvitacionMesa } from '../../core/utils/whatsapp-share';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
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
        <div class="custom-nav-bar">
          <ion-buttons slot="start" class="nav-start">
            <ion-back-button defaultHref="/events" text="" color="light"></ion-back-button>
          </ion-buttons>
          <div class="nav-center-title" [title]="evento()?.nombre || 'Detalle de Mesa'">
            <span class="nav-title-text">{{ evento()?.nombre || 'Detalle de Mesa' }}</span>
          </div>
          <div class="nav-end">
            @if (evento()?.estado) {
              <app-status-badge [status]="evento()!.estado"></app-status-badge>
            }
          </div>
        </div>
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
            <div class="hero-top-actions">
              <button type="button" class="hero-invite-pill" (click)="openInviteModal()">
                <ion-icon name="qr-code-outline"></ion-icon>
                <span>Invitar QR</span>
              </button>
              <span class="hero-comensales-pill">
                <ion-icon name="people-outline"></ion-icon>
                {{ ev.numero_comensales }}
              </span>
            </div>
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

        <!-- TABS DE NAVEGACIÓN: COMENSALES VS CUENTA DETALLADA -->
        <div class="tabs-segment-container">
          <ion-segment [value]="activeTab()" (ionChange)="activeTab.set($any($event.detail.value))" mode="ios">
            <ion-segment-button value="COMENSALES">
              <ion-label>👥 Comensales ({{ ev.participantes.length }})</ion-label>
            </ion-segment-button>
            <ion-segment-button value="CUENTA">
              <ion-label>🧾 Cuenta Detallada ({{ consumos().length }})</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>

        @if (activeTab() === 'COMENSALES') {
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
                          <span class="balance-pill credit"><span class="credit-dot"></span>Saldado</span>
                        } @else if ((p.deuda_pendiente_centavos ?? 0) > 0) {
                          <span class="balance-pill debt">
                            <span class="debt-dot"></span>Debe {{ p.deuda_pendiente_centavos | centavosADinero }}
                          </span>
                        } @else if ((p.por_cobrar_pendiente_centavos ?? 0) > 0) {
                          <span class="balance-pill credit">
                            <span class="credit-dot"></span>+{{ p.por_cobrar_pendiente_centavos | centavosADinero }} a favor
                          </span>
                        } @else {
                          <span class="balance-pill credit"><span class="credit-dot"></span>Cabal</span>
                        }
                      } @else {
                        @if (p.monto_consumido_centavos > p.monto_pagado_centavos) {
                          <span class="balance-pill debt">
                            <span class="debt-dot"></span>Debe {{ (p.monto_consumido_centavos - p.monto_pagado_centavos) | centavosADinero }}
                          </span>
                        } @else if (p.monto_pagado_centavos > p.monto_consumido_centavos) {
                          <span class="balance-pill credit">
                            <span class="credit-dot"></span>+{{ (p.monto_pagado_centavos - p.monto_consumido_centavos) | centavosADinero }} a favor
                          </span>
                        } @else {
                          <span class="balance-pill neutral">
                            Cabal ($0.00)
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
        } @else {
        <!-- SECCIÓN DE CUENTA DETALLADA (PLATOS Y BEBIDAS) -->
        <div class="section-container">
          <div class="section-header">
            <div>
              <h2 class="section-title">Platos & Bebidas</h2>
              <p class="section-subtitle">Detalle exacto de lo consumido en la mesa</p>
            </div>
            @if (ev.estado === 'ACTIVO') {
              <div class="header-action-group">
                <button
                  type="button"
                  class="tip-btn"
                  (click)="quickAddTip(10)"
                  [disabled]="isAddingTip() || ev.total_gastado_centavos === 0"
                >
                  <ion-icon name="sparkles-outline"></ion-icon>
                  <span>@if (isAddingTip()) { Calculando... } @else { +10% Propina }</span>
                </button>
                <button type="button" class="small-add-btn" (click)="openCreateConsumptionModal()">
                  <ion-icon name="restaurant-outline"></ion-icon>
                  <span>+ Plato</span>
                </button>
              </div>
            }
          </div>

          @if (isLoadingConsumos()) {
            <div class="loading-box">
              <ion-spinner name="crescent" color="primary"></ion-spinner>
              <p>Cargando detalle de consumos...</p>
            </div>
          } @else if (consumos().length === 0) {
            <div class="empty-table-box">
              <div class="empty-icon">🍽️</div>
              <p>Aún no has anotado ningún plato o consumo en esta mesa.</p>
              @if (ev.estado === 'ACTIVO') {
                <ion-button color="primary" fill="outline" shape="round" (click)="openCreateConsumptionModal()">
                  + Registrar Primer Consumo
                </ion-button>
              }
            </div>
          } @else {
            <div class="consumos-grid">
              @for (c of consumos(); track c.id) {
                <div class="consumo-item-card">
                  <div class="consumo-top-row">
                    <div class="consumo-info-group">
                      <div
                        class="consumo-icon-box"
                        [class.is-tip]="c.descripcion?.toLowerCase()?.includes('propina')"
                      >
                        <ion-icon [name]="c.descripcion?.toLowerCase()?.includes('propina') ? 'sparkles-outline' : 'restaurant-outline'"></ion-icon>
                      </div>
                      <div class="consumo-text">
                        <h4 class="consumo-title">{{ c.descripcion || 'Consumo sin descripción' }}</h4>
                        <span class="consumo-date">{{ c.creado_en | date:'shortTime' }} • {{ c.creado_en | date:'d MMM' }}</span>
                      </div>
                    </div>
                    <div class="consumo-amount-tag tabular-nums">
                      {{ c.monto_centavos | centavosADinero }}
                    </div>
                  </div>

                  <!-- Desglose de participantes -->
                  <div class="consumo-split-info">
                    <span class="split-label">
                      @if (c.participantes.length === 1) {
                        Consumido individualmente por:
                      } @else {
                        Dividido entre {{ c.participantes.length }} comensales:
                      }
                    </span>
                    <div class="split-chips-list">
                      @for (cp of c.participantes; track cp.id) {
                        <span class="split-user-chip">
                          {{ cp.es_fantasma ? '👻' : '👤' }} {{ cp.nombre_visible }}
                          <strong class="chip-cost">({{ cp.monto_centavos | centavosADinero }})</strong>
                        </span>
                      }
                    </div>
                  </div>

                  <!-- Acciones de edición / eliminación -->
                  @if (ev.estado === 'ACTIVO') {
                    <div class="consumo-card-actions">
                      <button type="button" class="consumo-btn-edit" (click)="openEditConsumptionModal(c)">
                        <ion-icon name="create-outline"></ion-icon>
                        <span>Editar</span>
                      </button>
                      <button type="button" class="consumo-btn-delete" (click)="deleteConsumption(c)">
                        <ion-icon name="trash-outline"></ion-icon>
                        <span>Eliminar</span>
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
        }

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
      } @else {
        <div class="error-state-card">
          <div class="error-icon-box">⚠️</div>
          <h3 class="error-title">No pudimos encontrar la mesa</h3>
          <p class="error-desc">Es posible que la mesa ya no exista o haya un error de conexión.</p>
          <button type="button" class="btn-return-home" (click)="goToDashboard()">
            <ion-icon name="arrow-back-outline"></ion-icon>
            <span>Volver a Mis Salidas</span>
          </button>
        </div>
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

      <!-- MODAL: REGISTRAR / EDITAR CONSUMO -->
      <ion-modal [isOpen]="isConsumptionModalOpen()" (didDismiss)="closeConsumptionModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>{{ isEditConsumptionMode() ? 'Editar Consumo' : 'Registrar Consumo' }}</h2>
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
                    {{ isEditConsumptionMode() ? 'Guardar Cambios' : 'Registrar Consumo' }}
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

      <!-- MODAL DE INVITACIÓN Y CÓDIGO QR -->
      <ion-modal [isOpen]="isInviteModalOpen()" (didDismiss)="closeInviteModal()" class="cabales-modal invite-modal">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <div class="assistant-header-text">
                <h2>Invitar a la Mesa</h2>
                <span class="assistant-sub">Escanea o comparte para unirse a la cuenta</span>
              </div>
              <button type="button" class="close-btn" (click)="closeInviteModal()">✕</button>
            </div>

            <div class="modal-body-content">
              <!-- QR Card -->
              <div class="qr-card">
                @if (qrCodeDataUrl()) {
                  <div class="qr-img-box">
                    <img [src]="qrCodeDataUrl()" alt="Código QR de la mesa" class="qr-preview-img" />
                  </div>
                } @else {
                  <div class="qr-loading-box">
                    <ion-spinner name="crescent" color="primary"></ion-spinner>
                    <p>Generando código QR...</p>
                  </div>
                }
                <div class="qr-card-info">
                  <h4 class="qr-event-title">{{ evento()?.nombre }}</h4>
                  <p class="qr-instructions">
                    Apunta con la cámara de tu celular para ver la cuenta en tiempo real y agregar tus consumos.
                  </p>
                </div>
              </div>

              <!-- Enlace Copiable -->
              <div class="invite-link-group">
                <span class="invite-link-label">Enlace de la mesa:</span>
                <div class="invite-link-bar">
                  <span class="invite-link-text">{{ currentTableUrl() }}</span>
                  <button type="button" class="copy-action-btn" (click)="copyTableLink()">
                    <ion-icon name="copy-outline"></ion-icon>
                    <span>Copiar</span>
                  </button>
                </div>
              </div>

              <!-- Acciones de Compartir -->
              <div class="invite-share-actions">
                <button type="button" class="btn-whatsapp-share" (click)="shareInviteWhatsApp()">
                  <ion-icon name="logo-whatsapp"></ion-icon>
                  <span>Invitar por WhatsApp</span>
                </button>
                <button type="button" class="btn-system-share" (click)="shareInviteSystem()">
                  <ion-icon name="share-social-outline"></ion-icon>
                  <span>Más opciones</span>
                </button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    .cabales-toolbar {
      --background: var(--ion-toolbar-background);
      --padding-start: 4px;
      --padding-end: 8px;
      --min-height: 56px;
    }

    .custom-nav-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 8px;
    }

    .nav-start {
      flex-shrink: 0;
    }

    .nav-center-title {
      flex: 1 1 auto;
      min-width: 0;
      text-align: center;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }

    .nav-title-text {
      font-family: 'Outfit', sans-serif;
      font-size: 1.05rem;
      font-weight: 700;
      color: #F1F1F1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      max-width: 100%;
    }

    .nav-end {
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .event-content {
      --background: var(--ion-background-color);
      padding-bottom: 120px;
    }

    .loading-box {
      text-align: center;
      padding: 60px 20px;
      color: #BEBEBE;
    }

    /* HERO CARD DE CONCILIACIÓN FINANCIERA */
    .hero-recon-card {
      background: rgba(33, 38, 32, 0.85);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 24px;
      padding: 20px 16px;
      margin: 12px 16px 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .hero-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
    }

    .hero-event-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1 1 140px;
      min-width: 0;
    }

    .hero-label {
      font-size: 0.72rem;
      color: #BEBEBE;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .hero-organizer {
      font-size: 0.78rem;
      color: #BEBEBE;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
    }

    .hero-top-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .hero-comensales-pill {
      background: rgba(0, 0, 0, 0.25);
      color: #F1F1F1;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      border: 1px solid rgba(113, 119, 109, 0.35);
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .fintech-metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1.2fr;
      gap: 10px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.3);
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
      color: #BEBEBE;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }

    .metric-value {
      font-size: 1.15rem;
      font-weight: 800;
      color: #F1F1F1;
      line-height: 1.2;

      &.text-emerald {
        color: #79ED91;
      }
    }

    .status-pill-covered {
      background: rgba(121, 237, 145, 0.16);
      color: #79ED91;
      border: 1px solid rgba(121, 237, 145, 0.4);
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-pill-pending {
      background: rgba(239, 68, 68, 0.16);
      color: #FCA5A5;
      border: 1px solid rgba(239, 68, 68, 0.4);
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-pill-neutral {
      color: #BEBEBE;
      font-size: 0.72rem;
      font-weight: 600;
    }

    .recon-bar-container {
      margin-top: 4px;
    }

    .recon-bar-track {
      height: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 9999px;
      overflow: hidden;
      margin-bottom: 6px;
    }

    .recon-bar-fill {
      height: 100%;
      background: #4DBE55;
      border-radius: 9999px;
      transition: width 0.4s ease;

      &.bar-full {
        background: #79ED91;
        box-shadow: 0 0 10px rgba(121, 237, 145, 0.5);
      }
    }

    .recon-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #BEBEBE;
      font-weight: 500;
    }

    .settlement-cta-banner {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(113, 119, 109, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .cta-info {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #79ED91;
      font-size: 0.82rem;
      font-weight: 600;
    }

    .cta-btn {
      background: #4DBE55;
      color: #141F14;
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

    /* TABS DE NAVEGACIÓN: COMENSALES VS CUENTA */
    .tabs-segment-container {
      margin: 0 16px 18px;

      ion-segment {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(113, 119, 109, 0.35);
        border-radius: 14px;
        padding: 4px;

        ion-segment-button {
          --color: #BEBEBE;
          --color-checked: #F1F1F1;
          --indicator-color: #4DBE55;
          --indicator-box-shadow: 0 4px 12px rgba(77, 190, 85, 0.35);
          font-weight: 700;
          font-size: 0.82rem;
          min-height: 38px;
        }
      }
    }

    .header-action-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tip-btn {
      background: rgba(121, 237, 145, 0.15);
      border: 1px solid rgba(121, 237, 145, 0.35);
      color: #79ED91;
      border-radius: 9999px;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        background: rgba(121, 237, 145, 0.25);
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    /* CONSUMOS DETALLADOS */
    .consumos-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .consumo-item-card {
      background: rgba(33, 38, 32, 0.85);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 18px;
      padding: 16px;
      transition: all 0.2s ease;

      &:hover {
        border-color: rgba(77, 190, 85, 0.45);
      }
    }

    .consumo-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .consumo-info-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .consumo-icon-box {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: rgba(77, 190, 85, 0.15);
      color: #79ED91;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;

      &.is-tip {
        background: rgba(245, 158, 11, 0.15);
        color: #FBBF24;
      }
    }

    .consumo-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .consumo-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #F1F1F1;
    }

    .consumo-date {
      font-size: 0.72rem;
      color: #BEBEBE;
    }

    .consumo-amount-tag {
      font-size: 1.2rem;
      font-weight: 800;
      color: #F1F1F1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(113, 119, 109, 0.3);
      padding: 4px 10px;
      border-radius: 10px;
    }

    .consumo-split-info {
      padding: 10px 12px;
      background: rgba(0, 0, 0, 0.22);
      border-radius: 12px;
      margin-bottom: 10px;
    }

    .split-label {
      display: block;
      font-size: 0.72rem;
      color: #BEBEBE;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 6px;
    }

    .split-chips-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .split-user-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      padding: 3px 10px;
      font-size: 0.76rem;
      color: #F1F1F1;
      display: inline-flex;
      align-items: center;
      gap: 4px;

      .chip-cost {
        color: #79ED91;
        font-weight: 700;
      }
    }

    .consumo-card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid rgba(113, 119, 109, 0.2);
      padding-top: 10px;
      margin-top: 8px;
    }

    .consumo-btn-edit, .consumo-btn-delete {
      background: none;
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 8px;
      padding: 5px 10px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.76rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .consumo-btn-edit {
      color: #79ED91;
      &:hover {
        background: rgba(121, 237, 145, 0.15);
        border-color: #79ED91;
      }
    }

    .consumo-btn-delete {
      color: #FCA5A5;
      &:hover {
        background: rgba(239, 68, 68, 0.15);
        border-color: #EF4444;
      }
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
      color: #F1F1F1;
      margin: 0;
    }

    .section-subtitle {
      font-size: 0.78rem;
      color: #BEBEBE;
      margin: 2px 0 0;
    }

    .small-add-btn {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #79ED91;
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
      background: rgba(0, 0, 0, 0.25);
      border-radius: 20px;
      border: 1px dashed rgba(113, 119, 109, 0.35);
      color: #BEBEBE;
      font-size: 0.9rem;
    }

    .participants-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .participant-balance-card {
      background: rgba(33, 38, 32, 0.75);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 18px;
      padding: 14px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      transition: transform 0.15s ease, border-color 0.2s ease;

      &.is-debtor {
        border-color: rgba(239, 68, 68, 0.45);
      }

      &.is-creditor {
        border-color: rgba(121, 237, 145, 0.4);
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
        background: rgba(239, 68, 68, 0.16);
        color: #FCA5A5;
        border: 2px solid #EF4444;
      }

      &.avatar-credit {
        background: rgba(121, 237, 145, 0.16);
        color: #79ED91;
        border: 2px solid #4DBE55;
      }

      &.avatar-neutral {
        background: rgba(0, 0, 0, 0.25);
        color: #BEBEBE;
        border: 2px solid rgba(113, 119, 109, 0.35);
      }
    }

    .debt-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #EF4444;
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
      display: inline-block;
    }

    .credit-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #4DBE55;
      box-shadow: 0 0 6px rgba(77, 190, 85, 0.5);
      display: inline-block;
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
      color: #F1F1F1;
      font-size: 0.96rem;
    }

    .organizer-badge {
      font-size: 0.65rem;
      font-weight: 700;
      color: #79ED91;
      background: rgba(77, 190, 85, 0.16);
      border: 1px solid rgba(77, 190, 85, 0.35);
      padding: 1px 6px;
      border-radius: 9999px;
    }

    .ghost-badge {
      font-size: 0.65rem;
      font-weight: 600;
      color: #BEBEBE;
      background: rgba(0, 0, 0, 0.25);
      padding: 1px 6px;
      border-radius: 9999px;
    }

    .p-breakdown {
      font-size: 0.74rem;
      color: #BEBEBE;
      display: flex;
      align-items: center;
      gap: 5px;

      strong {
        color: #F1F1F1;
      }

      .bullet {
        color: #71776D;
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
      border-top: 1px solid rgba(113, 119, 109, 0.25);
    }

    .quick-action-btn {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #BEBEBE;
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
        background: rgba(113, 119, 109, 0.3);
        color: #F1F1F1;
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
      background: rgba(23, 27, 22, 0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(113, 119, 109, 0.4);
      border-radius: 9999px;
      padding: 6px;
      display: flex;
      gap: 8px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
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
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(113, 119, 109, 0.35);
        color: #F1F1F1;

        &:hover {
          background: rgba(113, 119, 109, 0.3);
        }
      }

      &.btn-payment {
        background: rgba(77, 190, 85, 0.15);
        color: #79ED91;
        border: 1px solid rgba(77, 190, 85, 0.35);

        &:hover {
          background: rgba(77, 190, 85, 0.25);
          color: #F1F1F1;
        }
      }

      &.btn-close {
        background: #4DBE55;
        color: #141F14;
        font-weight: 800;
        box-shadow: 0 4px 14px rgba(77, 190, 85, 0.35);
      }
    }

    /* ESTILOS DE MODALES */
    .modal-wrapper {
      background: #212620;
      height: 100%;
      padding: 24px 20px;
      color: #F1F1F1;
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
        color: #F1F1F1;
      }
    }

    .assistant-header-text {
      h2 {
        margin: 0;
        font-family: 'Outfit', sans-serif;
        font-size: 1.3rem;
        font-weight: 800;
        color: #F1F1F1;
      }

      .assistant-sub {
        font-size: 0.78rem;
        color: #BEBEBE;
        display: block;
        margin-top: 3px;
      }
    }

    .close-btn {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #BEBEBE;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 1rem;
      cursor: pointer;

      &:hover {
        color: #F1F1F1;
      }
    }

    .modal-body {
      flex: 1;
    }

    .modal-desc {
      font-size: 0.85rem;
      color: #BEBEBE;
      margin-bottom: 18px;
    }

    .input-hint {
      font-size: 0.8rem;
      color: #BEBEBE;
      margin-bottom: 14px;
    }

    .participant-form-body {
      margin-top: 18px;
    }

    /* ASISTENTE DE CIERRE BOXES */
    .unsettled-notice-box {
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .notice-icon-box {
      color: #EF4444;
      font-size: 1.8rem;
      line-height: 1;
    }

    .notice-info {
      h3 {
        margin: 0 0 4px;
        font-size: 0.95rem;
        font-weight: 700;
        color: #FCA5A5;
      }

      p {
        margin: 0;
        font-size: 0.82rem;
        color: #F1F1F1;
        line-height: 1.4;

        strong {
          color: #FCA5A5;
        }
      }
    }

    .settled-notice-box {
      background: rgba(121, 237, 145, 0.16);
      border: 1px solid rgba(121, 237, 145, 0.4);
      border-radius: 20px;
      padding: 24px 18px;
      text-align: center;
      margin-bottom: 24px;

      ion-icon {
        font-size: 2.5rem;
        color: #79ED91;
        margin-bottom: 8px;
      }

      h3 {
        margin: 0 0 8px;
        font-size: 1.2rem;
        font-weight: 800;
        color: #F1F1F1;
      }

      p {
        margin: 0;
        font-size: 0.85rem;
        color: #BEBEBE;
        line-height: 1.4;
      }

      .settled-helper {
        margin-top: 10px;
        color: #BEBEBE;
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
      color: #F1F1F1;
      margin-bottom: 12px;
    }

    .assistant-choice-card {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
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
        background: rgba(77, 190, 85, 0.18);
        border-color: #4DBE55;
      }
    }

    .choice-icon {
      font-size: 1.6rem;
      color: #79ED91;
    }

    .choice-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .choice-heading {
      font-size: 0.9rem;
      font-weight: 700;
      color: #F1F1F1;
    }

    .choice-desc {
      font-size: 0.76rem;
      color: #BEBEBE;
      line-height: 1.3;
    }

    .other-payers-section {
      margin-top: 14px;
    }

    .other-payers-label {
      font-size: 0.78rem;
      color: #BEBEBE;
      margin-bottom: 8px;
      display: block;
    }

    .cancel-link-btn {
      background: none;
      border: none;
      color: #BEBEBE;
      font-size: 0.8rem;
      font-weight: 600;
      margin-top: 12px;
      width: 100%;
      text-align: center;
      cursor: pointer;
      padding: 8px;

      &:hover {
        color: #F1F1F1;
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
      color: #F1F1F1;
      display: block;
      margin-bottom: 8px;
    }

    .toggle-all-btn {
      background: none;
      border: none;
      color: #79ED91;
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
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 9999px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: #BEBEBE;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;

      &.is-selected {
        background: rgba(77, 190, 85, 0.2);
        border-color: #4DBE55;
        color: #F1F1F1;
        font-weight: 700;
      }
    }

    .split-preview-banner {
      background: rgba(77, 190, 85, 0.12);
      border: 1px solid rgba(77, 190, 85, 0.3);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 0.82rem;
      color: #F1F1F1;
      margin-top: 14px;
      text-align: center;

      strong {
        color: #79ED91;
      }
    }

    .modal-actions {
      margin-top: 20px;
      padding-bottom: 24px;
    }

    .header-qr-btn {
      --color: #79ED91;
    }

    .hero-top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hero-invite-pill {
      background: rgba(77, 190, 85, 0.15);
      border: 1px solid rgba(77, 190, 85, 0.4);
      color: #79ED91;
      font-size: 0.76rem;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      transition: transform 0.15s ease, background 0.15s ease;

      &:active {
        transform: scale(0.95);
      }

      &:hover {
        background: rgba(77, 190, 85, 0.25);
      }
    }

    /* ESTILOS DE QR E INVITACIÓN */
    .qr-card {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(113, 119, 109, 0.3);
      border-radius: 20px;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-bottom: 20px;
    }

    .qr-img-box {
      background: #FFFFFF;
      padding: 14px;
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .qr-preview-img {
      width: 200px;
      height: 200px;
      display: block;
    }

    .qr-loading-box {
      height: 200px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #BEBEBE;
      font-size: 0.85rem;
    }

    .qr-card-info {
      .qr-event-title {
        margin: 0 0 6px 0;
        font-size: 1.1rem;
        font-weight: 800;
        color: #F1F1F1;
      }

      .qr-instructions {
        margin: 0;
        font-size: 0.82rem;
        color: #BEBEBE;
        max-width: 280px;
        line-height: 1.4;
      }
    }

    .invite-link-group {
      margin-bottom: 20px;
    }

    .invite-link-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: #BEBEBE;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: block;
      margin-bottom: 6px;
    }

    .invite-link-bar {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 14px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .invite-link-text {
      font-size: 0.8rem;
      color: #79ED91;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: monospace;
    }

    .copy-action-btn {
      background: rgba(113, 119, 109, 0.3);
      border: 1px solid rgba(113, 119, 109, 0.45);
      border-radius: 8px;
      color: #F1F1F1;
      padding: 6px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease;

      &:hover {
        background: rgba(113, 119, 109, 0.45);
      }
    }

    .invite-share-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 8px;
    }

    .btn-whatsapp-share {
      background: #25D366;
      color: #141F14;
      border: none;
      border-radius: 14px;
      padding: 14px;
      font-size: 0.95rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.15s ease;

      ion-icon {
        font-size: 1.3rem;
      }

      &:hover {
        filter: brightness(1.06);
      }

      &:active {
        transform: scale(0.98);
      }
    }

    .btn-system-share {
      background: rgba(0, 0, 0, 0.25);
      color: #F1F1F1;
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 14px;
      padding: 12px;
      font-size: 0.88rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      transition: background 0.15s ease;

      &:hover {
        background: rgba(113, 119, 109, 0.25);
      }
    }

    .error-state-card {
      margin: 40px 16px;
      padding: 32px 20px;
      background: #1B291B;
      border: 1px solid rgba(113, 119, 109, 0.3);
      border-radius: 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;

      .error-icon-box {
        font-size: 2.5rem;
      }

      .error-title {
        font-size: 1.2rem;
        font-weight: 800;
        color: #F1F1F1;
        margin: 0;
      }

      .error-desc {
        font-size: 0.9rem;
        color: #BEBEBE;
        margin: 0 0 12px 0;
        max-width: 280px;
        line-height: 1.4;
      }

      .btn-return-home {
        background: #4DBE55;
        color: #141F14;
        border: none;
        border-radius: 12px;
        padding: 12px 20px;
        font-size: 0.9rem;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
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

  // Pestaña activa
  activeTab = signal<'COMENSALES' | 'CUENTA'>('COMENSALES');

  // Consumos detallados
  consumos = signal<ConsumoDTO[]>([]);
  isLoadingConsumos = signal<boolean>(false);
  isEditConsumptionMode = signal<boolean>(false);
  editingConsumptionId = signal<string>('');
  isAddingTip = signal<boolean>(false);

  // Invitación y QR
  isInviteModalOpen = signal<boolean>(false);
  qrCodeDataUrl = signal<string>('');
  currentTableUrl = computed(() => {
    const id = this.eventId();
    return typeof window !== 'undefined' ? `${window.location.origin}/events/${id}` : '';
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
      addOutline,
      createOutline,
      trashOutline,
      pricetagOutline,
      qrCodeOutline,
      shareSocialOutline,
      copyOutline,
      logoWhatsapp,
      linkOutline,
      arrowBackOutline
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.eventId.set(id);
      // Solo inicializamos el ID; ionViewWillEnter ejecutará la carga real sin duplicados
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
        this.loadConsumos();
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

  // --- CONSUMOS DETALLADOS ---

  loadConsumos(): void {
    const id = this.eventId();
    if (!id) return;

    this.isLoadingConsumos.set(true);
    this.api.obtenerConsumos(id).subscribe({
      next: (data) => {
        this.consumos.set(data);
        this.isLoadingConsumos.set(false);
      },
      error: () => {
        this.isLoadingConsumos.set(false);
      }
    });
  }

  openCreateConsumptionModal(): void {
    this.isEditConsumptionMode.set(false);
    this.editingConsumptionId.set('');
    this.consumptionDesc.set('');
    this.consumptionCentavos.set(0);
    const allIds = (this.evento()?.participantes || []).map((p) => p.id);
    this.selectedParticipantIds.set(allIds);
    this.isConsumptionModalOpen.set(true);
  }

  openEditConsumptionModal(consumo: ConsumoDTO): void {
    this.isEditConsumptionMode.set(true);
    this.editingConsumptionId.set(consumo.id);
    this.consumptionDesc.set(consumo.descripcion || '');
    this.consumptionCentavos.set(consumo.monto_centavos);
    this.selectedParticipantIds.set(consumo.participantes.map((p) => p.participante_id));
    this.isConsumptionModalOpen.set(true);
  }

  openConsumptionModal(): void {
    this.openCreateConsumptionModal();
  }

  closeConsumptionModal(): void {
    this.isConsumptionModalOpen.set(false);
    this.isEditConsumptionMode.set(false);
    this.editingConsumptionId.set('');
  }

  quickConsumoFor(participanteId: string): void {
    this.isEditConsumptionMode.set(false);
    this.editingConsumptionId.set('');
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

    if (this.isEditConsumptionMode()) {
      this.api.actualizarConsumo(this.eventId(), this.editingConsumptionId(), {
        monto_centavos: monto,
        participante_ids: ids,
        descripcion: this.consumptionDesc().trim() || undefined
      }).subscribe({
        next: async () => {
          this.isSavingConsumption.set(false);
          this.closeConsumptionModal();
          this.loadEvent();
          const toast = await this.toastCtrl.create({
            message: 'Consumo actualizado',
            duration: 2000,
            color: 'primary',
            position: 'top'
          });
          await toast.present();
        },
        error: () => {
          this.isSavingConsumption.set(false);
        }
      });
    } else {
      this.api.registrarConsumo(this.eventId(), {
        monto_centavos: monto,
        participante_ids: ids,
        descripcion: this.consumptionDesc().trim() || undefined
      }).subscribe({
        next: async () => {
          this.isSavingConsumption.set(false);
          this.closeConsumptionModal();
          this.loadEvent();
          const toast = await this.toastCtrl.create({
            message: 'Consumo agregado a la mesa',
            duration: 2000,
            color: 'primary',
            position: 'top'
          });
          await toast.present();
        },
        error: () => {
          this.isSavingConsumption.set(false);
        }
      });
    }
  }

  deleteConsumption(consumo: ConsumoDTO): void {
    if (this.evento()?.estado === 'CERRADO') return;

    this.api.eliminarConsumo(this.eventId(), consumo.id).subscribe({
      next: async () => {
        this.loadEvent();
        const toast = await this.toastCtrl.create({
          message: 'Consumo eliminado de la mesa',
          duration: 2000,
          color: 'medium',
          position: 'top'
        });
        await toast.present();
      }
    });
  }

  quickAddTip(porcentaje: number = 10): void {
    if (this.evento()?.estado === 'CERRADO' || this.totalConsumidoCentavos() === 0) return;

    this.isAddingTip.set(true);
    this.api.agregarPropina(this.eventId(), { porcentaje }).subscribe({
      next: async () => {
        this.isAddingTip.set(false);
        this.loadEvent();
        const toast = await this.toastCtrl.create({
          message: `Propina del ${porcentaje}% agregada a la cuenta`,
          duration: 2500,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      },
      error: () => {
        this.isAddingTip.set(false);
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

  // --- INVITACIÓN Y CÓDIGO QR ---

  async openInviteModal(): Promise<void> {
    this.isInviteModalOpen.set(true);
    const url = this.currentTableUrl();
    if (url) {
      try {
        const qr = await QRCode.toDataURL(url, {
          width: 260,
          margin: 2,
          color: {
            dark: '#141F14',
            light: '#FFFFFF'
          }
        });
        this.qrCodeDataUrl.set(qr);
      } catch (err) {
        console.error('Error generando QR:', err);
      }
    }
  }

  closeInviteModal(): void {
    this.isInviteModalOpen.set(false);
  }

  async copyTableLink(): Promise<void> {
    const url = this.currentTableUrl();
    if (!url) return;
    const ok = await copiarTextoAlPortapapeles(url);
    if (ok) {
      const toast = await this.toastCtrl.create({
        message: '¡Enlace de la mesa copiado al portapapeles!',
        duration: 2500,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    }
  }

  async shareInviteWhatsApp(): Promise<void> {
    const ev = this.evento();
    const url = this.currentTableUrl();
    if (!ev || !url) return;
    const mensaje = generarMensajeInvitacionMesa(ev, url);
    await compartirTexto(`Mesa en Cabales: ${ev.nombre}`, mensaje);
  }

  async shareInviteSystem(): Promise<void> {
    const ev = this.evento();
    const url = this.currentTableUrl();
    if (!ev || !url) return;
    const mensaje = generarMensajeInvitacionMesa(ev, url);
    await compartirTexto(`Mesa en Cabales: ${ev.nombre}`, mensaje);
  }

  goToDashboard(): void {
    this.router.navigate(['/events']);
  }
}

