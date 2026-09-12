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
  AlertController,
  ToastController
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  arrowForwardOutline,
  checkmarkDoneOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  documentTextOutline,
  cashOutline,
  cloudUploadOutline,
  sparklesOutline,
  shieldCheckmarkOutline,
  timeOutline
} from 'ionicons/icons';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { TransaccionDTO, EstadoTransaccion } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';

@Component({
  selector: 'app-settlement',
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
    CentavosADineroPipe,
    StatusBadgeComponent
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="cabales-toolbar">
        <ion-buttons slot="start">
          <ion-back-button [defaultHref]="'/events/' + eventId()" text="" color="light"></ion-back-button>
        </ion-buttons>
        <ion-title class="header-title">Liquidación de Mesa</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="settlement-content" [fullscreen]="true">
      @if (isLoading()) {
        <div class="loading-box">
          <ion-spinner name="crescent" color="primary"></ion-spinner>
          <p>Calculando transferencias mínimas...</p>
        </div>
      } @else {
        <!-- Celebratory or In-Progress Hero Banner -->
        <div class="hero-settlement-card" [class.all-settled]="allCompleted()">
          <div class="settlement-icon-circle">
            <ion-icon [name]="allCompleted() ? 'sparkles-outline' : 'shield-checkmark-outline'"></ion-icon>
          </div>
          <h2 class="settlement-headline">
            {{ allCompleted() ? '¡Todos Cabales!' : 'Flujo Mínimo de Efectivo' }}
          </h2>
          <p class="settlement-subline">
            @if (allCompleted()) {
              Todas las transferencias han sido completadas con éxito. Nadie le debe nada a nadie.
            } @else {
              El motor matemático optimizó la mesa para saldar todas las deudas con solo
              <strong>{{ transactions().length }} transferencias</strong>.
            }
          </p>
        </div>

        <!-- Transactions List -->
        <div class="transactions-container">
          <div class="section-top">
            <h3 class="container-title">Transferencias Requeridas</h3>
            <span class="completed-counter">
              {{ completedCount() }} de {{ transactions().length }} saldadas
            </span>
          </div>

          @if (transactions().length === 0) {
            <div class="empty-debts-box">
              <p>No se requirieron transferencias. ¡Todos pusieron exactamente lo que consumieron!</p>
            </div>
          } @else {
            <div class="cards-list">
              @for (t of transactions(); track t.id) {
                <div class="tx-card" [class.tx-completed]="t.estado === 'COMPLETADO'">
                  <!-- Transfer Flow Row -->
                  <div class="tx-flow-row">
                    <!-- Deudor -->
                    <div class="person-box debtor">
                      <div class="avatar-circle debtor-avatar">
                        {{ t.deudor.nombre_visible.charAt(0) }}
                      </div>
                      <span class="person-name">{{ t.deudor.nombre_visible }}</span>
                      <span class="person-role">Debe</span>
                    </div>

                    <!-- Flow Arrow & Amount -->
                    <div class="arrow-amount-box">
                      <span class="tx-amount tabular-nums">
                        {{ t.monto_centavos | centavosADinero }}
                      </span>
                      <div class="arrow-line">
                        <ion-icon name="arrow-forward-outline"></ion-icon>
                      </div>
                    </div>

                    <!-- Acreedor -->
                    <div class="person-box creditor">
                      <div class="avatar-circle creditor-avatar">
                        {{ t.acreedor.nombre_visible.charAt(0) }}
                      </div>
                      <span class="person-name">{{ t.acreedor.nombre_visible }}</span>
                      <span class="person-role">Recibe</span>
                    </div>
                  </div>

                  <!-- Status Row -->
                  <div class="tx-status-row">
                    <app-status-badge [status]="t.estado"></app-status-badge>
                    @if (t.comprobante_url) {
                      <a [href]="t.comprobante_url" target="_blank" class="receipt-link">
                        <ion-icon name="document-text-outline"></ion-icon>
                        <span>Ver comprobante</span>
                      </a>
                    }
                  </div>

                  <!-- Actions based on State -->
                  @if (t.estado === 'PENDIENTE') {
                    <div class="tx-actions-grid">
                      <button class="tx-btn btn-cash" (click)="advanceStatusDirect(t.id, 'COMPLETADO')">
                        <ion-icon name="cash-outline"></ion-icon>
                        <span>Pagué en Efectivo</span>
                      </button>
                      <button class="tx-btn btn-proof" (click)="openProofModal(t.id)">
                        <ion-icon name="cloud-upload-outline"></ion-icon>
                        <span>Subir Comprobante</span>
                      </button>
                    </div>
                  } @else if (t.estado === 'EN_REVISION') {
                    <div class="review-helper-box">
                      <ion-icon name="time-outline"></ion-icon>
                      <span>Comprobante en revisión por el acreedor (7 días de auto-aprobación).</span>
                    </div>
                    <div class="tx-actions-grid">
                      <button class="tx-btn btn-confirm" (click)="advanceStatusDirect(t.id, 'COMPLETADO')">
                        <ion-icon name="checkmark-done-outline"></ion-icon>
                        <span>Confirmar Recibido</span>
                      </button>
                      <button class="tx-btn btn-dispute" (click)="advanceStatusDirect(t.id, 'EN_DISPUTA')">
                        <ion-icon name="alert-circle-outline"></ion-icon>
                        <span>Disputar</span>
                      </button>
                    </div>
                  } @else if (t.estado === 'EN_DISPUTA') {
                    <div class="dispute-alert-box">
                      <ion-icon name="alert-circle-outline"></ion-icon>
                      <span>Transacción en disputa. Hablen para corroborar el pago.</span>
                    </div>
                    <div class="tx-actions-grid">
                      <button class="tx-btn btn-confirm" (click)="advanceStatusDirect(t.id, 'COMPLETADO')">
                        <ion-icon name="checkmark-done-outline"></ion-icon>
                        <span>Resolver y Confirmar</span>
                      </button>
                      <button class="tx-btn btn-proof" (click)="openProofModal(t.id)">
                        <span>Nuevo Comprobante</span>
                      </button>
                    </div>
                  } @else if (t.estado === 'COMPLETADO') {
                    <div class="completed-check-banner">
                      <ion-icon name="checkmark-circle-outline"></ion-icon>
                      <span>Transferencia saldada</span>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- MODAL: SUBIR COMPROBANTE -->
      <ion-modal [isOpen]="isProofModalOpen()" (didDismiss)="closeProofModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Adjuntar Comprobante</h2>
              <button class="close-btn" (click)="closeProofModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-desc">
                Ingresa el enlace o URL de la captura de tu transferencia bancaria (ej. Chivo, Agrícola, BAC, etc.):
              </p>

              <ion-item class="cabales-input-item" lines="none">
                <ion-input
                  label="URL del Comprobante"
                  labelPlacement="stacked"
                  placeholder="https://i.imgur.com/... o enlace de captura"
                  [value]="proofUrl()"
                  (ionInput)="proofUrl.set($any($event.target).value)"
                ></ion-input>
              </ion-item>

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSubmittingProof() || !proofUrl().trim()"
                  (click)="submitProof()"
                >
                  @if (isSubmittingProof()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    Enviar a Revisión
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

    .settlement-content {
      --background: #0B0F19;
      padding: 16px;
    }

    .loading-box {
      text-align: center;
      padding: 60px 20px;
      color: #94A3B8;
    }

    .hero-settlement-card {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 24px;
      padding: 24px 20px;
      margin: 12px 16px 24px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);

      &.all-settled {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.2) 100%);
        border-color: rgba(16, 185, 129, 0.4);
      }
    }

    .settlement-icon-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.2);
      color: var(--ion-color-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.8rem;
      margin: 0 auto 12px;
    }

    .settlement-headline {
      font-family: 'Outfit', sans-serif;
      font-size: 1.5rem;
      font-weight: 800;
      color: #F8FAFC;
      margin: 0 0 6px;
    }

    .settlement-subline {
      font-size: 0.85rem;
      color: #94A3B8;
      line-height: 1.4;
      margin: 0;

      strong {
        color: var(--ion-color-primary);
      }
    }

    .transactions-container {
      padding: 0 16px 60px;
    }

    .section-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .container-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.15rem;
      font-weight: 700;
      color: #F8FAFC;
      margin: 0;
    }

    .completed-counter {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--ion-color-primary);
    }

    .empty-debts-box {
      text-align: center;
      padding: 30px;
      background: #151D30;
      border-radius: 20px;
      color: #94A3B8;
    }

    .cards-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .tx-card {
      background: #151D30;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 18px 16px;
      transition: all 0.2s ease;

      &.tx-completed {
        border-color: rgba(16, 185, 129, 0.2);
        background: rgba(21, 29, 48, 0.6);
      }
    }

    .tx-flow-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .person-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 85px;
      text-align: center;
    }

    .avatar-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.1rem;
      margin-bottom: 6px;
    }

    .debtor-avatar {
      background: rgba(239, 68, 68, 0.15);
      color: #F87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .creditor-avatar {
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .person-name {
      font-size: 0.85rem;
      font-weight: 700;
      color: #F8FAFC;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .person-role {
      font-size: 0.65rem;
      text-transform: uppercase;
      font-weight: 600;
      color: #64748B;
      letter-spacing: 0.05em;
    }

    .arrow-amount-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      padding: 0 12px;
    }

    .tx-amount {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--ion-color-primary);
      margin-bottom: 4px;
      letter-spacing: -0.02em;
    }

    .arrow-line {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94A3B8;
      font-size: 1.2rem;
    }

    .tx-status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 12px;
    }

    .receipt-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      color: var(--ion-color-secondary-tint);
      text-decoration: none;
    }

    .tx-actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .tx-btn {
      height: 40px;
      border: none;
      border-radius: 12px;
      font-size: 0.78rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:active {
        transform: scale(0.96);
      }
    }

    .btn-cash {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34D399;
    }

    .btn-proof {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818CF8;
    }

    .btn-confirm {
      background: var(--ion-color-primary);
      color: #064E3B;
    }

    .btn-dispute {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #F87171;
    }

    .review-helper-box, .dispute-alert-box {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      border-radius: 10px;
      padding: 8px 10px;
      margin-bottom: 10px;
    }

    .review-helper-box {
      background: rgba(59, 130, 246, 0.1);
      color: #93C5FD;
    }

    .dispute-alert-box {
      background: rgba(239, 68, 68, 0.1);
      color: #FCA5A5;
    }

    .completed-check-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #34D399;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 4px 0;
    }

    /* Modal */
    .modal-wrapper {
      background: #151D30;
      padding: 24px;
      height: 100%;
      color: #F8FAFC;
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

    .modal-actions {
      margin-top: 24px;
    }
  `]
})
export class SettlementPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(CabalesApiService);
  private toastCtrl = inject(ToastController);

  eventId = signal<string>('');
  transactions = signal<TransaccionDTO[]>([]);
  isLoading = signal<boolean>(true);

  // Proof Modal
  isProofModalOpen = signal<boolean>(false);
  activeTxIdForProof = signal<string>('');
  proofUrl = signal<string>('');
  isSubmittingProof = signal<boolean>(false);

  completedCount = computed(() => {
    return this.transactions().filter((t) => t.estado === 'COMPLETADO').length;
  });

  allCompleted = computed(() => {
    const list = this.transactions();
    return list.length > 0 && this.completedCount() === list.length;
  });

  constructor() {
    addIcons({
      arrowForwardOutline,
      checkmarkDoneOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      documentTextOutline,
      cashOutline,
      cloudUploadOutline,
      sparklesOutline,
      shieldCheckmarkOutline,
      timeOutline
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.eventId.set(id);
      this.loadTransactions();
    }
  }

  loadTransactions(): void {
    const id = this.eventId();
    if (!id) return;

    this.isLoading.set(true);
    this.api.obtenerTransacciones(id).subscribe({
      next: (data) => {
        this.transactions.set(data || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  advanceStatusDirect(txId: string, nuevoEstado: EstadoTransaccion): void {
    this.api.actualizarEstadoTransaccion(txId, { estado: nuevoEstado }).subscribe({
      next: () => {
        this.toastCtrl.create({
          message: nuevoEstado === 'COMPLETADO' ? '¡Transferencia saldada!' : 'Estado actualizado',
          duration: 2000,
          color: 'success'
        }).then((t) => t.present());
        this.loadTransactions();
      }
    });
  }

  openProofModal(txId: string): void {
    this.activeTxIdForProof.set(txId);
    this.proofUrl.set('');
    this.isProofModalOpen.set(true);
  }

  closeProofModal(): void {
    this.isProofModalOpen.set(false);
  }

  submitProof(): void {
    const txId = this.activeTxIdForProof();
    const url = this.proofUrl().trim();
    if (!txId || !url) return;

    this.isSubmittingProof.set(true);
    this.api.actualizarEstadoTransaccion(txId, {
      estado: 'EN_REVISION',
      comprobante_url: url
    }).subscribe({
      next: () => {
        this.isSubmittingProof.set(false);
        this.closeProofModal();
        this.toastCtrl.create({
          message: 'Comprobante enviado a revisión',
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
        this.loadTransactions();
      },
      error: () => {
        this.isSubmittingProof.set(false);
      }
    });
  }
}
