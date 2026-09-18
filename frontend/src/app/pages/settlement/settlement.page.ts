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
  AlertController,
  ToastController,
  ViewWillEnter
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
  timeOutline,
  imageOutline,
  cameraOutline,
  trashOutline,
  swapHorizontalOutline,
  openOutline
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
              <div class="empty-icon-circle">🎉</div>
              <h4>¡No se requirieron transferencias!</h4>
              <p>Todos los comensales cubrieron exactamente lo que consumieron.</p>
            </div>
          } @else {
            <div class="tx-cards-stack">
              @for (t of transactions(); track t.id) {
                <div class="tx-flow-card" [class.settled]="t.estado === 'COMPLETADO'">
                  <!-- People Row -->
                  <div class="tx-parties-row">
                    <!-- Deudor -->
                    <div class="person-box debtor">
                      <div class="avatar-circle debtor-avatar">
                        {{ t.deudor.nombre_visible.charAt(0) }}
                      </div>
                      <span class="person-name">{{ t.deudor.nombre_visible }}</span>
                      <span class="person-role">Transfiere</span>
                    </div>

                    <!-- Flow Amount Arrow -->
                    <div class="amount-arrow-box">
                      <span class="transfer-amount">
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
                      <button type="button" class="receipt-pill-btn" (click)="openReceiptViewer(t)">
                        <ion-icon name="image-outline"></ion-icon>
                        <span>Ver Comprobante</span>
                      </button>
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
                        <ion-icon name="cloud-upload-outline"></ion-icon>
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
              <div class="header-title-box">
                <ion-icon name="camera-outline" class="modal-title-icon"></ion-icon>
                <h2>Adjuntar Comprobante</h2>
              </div>
              <button class="close-btn" (click)="closeProofModal()">✕</button>
            </div>

            <div class="modal-body">
              <p class="modal-desc">
                Sube una captura de pantalla de la transferencia bancaria (ej. BAC, Agrícola, Chivo, Cuscatlán):
              </p>

              <!-- Hidden native file input -->
              <input
                #fileInput
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/heic"
                (change)="onFileSelected($event)"
                style="display: none;"
              />

              @if (!selectedFile()) {
                <!-- Drag & Drop / Click Zone -->
                <div
                  class="dropzone-box"
                  [class.drag-over]="isDragOver()"
                  (click)="fileInput.click()"
                  (dragover)="onDragOver($event)"
                  (dragleave)="onDragLeave($event)"
                  (drop)="onFileDrop($event)"
                >
                  <div class="dropzone-icon-circle">
                    <ion-icon name="cloud-upload-outline"></ion-icon>
                  </div>
                  <span class="dropzone-title">Toca para elegir de tu galería</span>
                  <span class="dropzone-sub">o arrastra la imagen aquí</span>
                  <div class="dropzone-tags">
                    <span class="badge-tag">JPG</span>
                    <span class="badge-tag">PNG</span>
                    <span class="badge-tag">WEBP</span>
                    <span class="badge-tag">Máx 10 MB</span>
                  </div>
                </div>
              } @else {
                <!-- Image Preview Box -->
                <div class="preview-card">
                  <div class="preview-image-wrap">
                    <img [src]="previewUrl()" alt="Vista previa del comprobante" class="preview-img" />
                  </div>
                  <div class="preview-meta">
                    <div class="meta-info">
                      <span class="file-name">{{ selectedFile()?.name }}</span>
                      <span class="file-size">{{ formatFileSize(selectedFile()?.size || 0) }}</span>
                    </div>
                    <div class="preview-actions">
                      <button type="button" class="action-btn change-btn" (click)="fileInput.click()">
                        <ion-icon name="swap-horizontal-outline"></ion-icon>
                        <span>Cambiar</span>
                      </button>
                      <button type="button" class="action-btn remove-btn" (click)="removeSelectedFile()">
                        <ion-icon name="trash-outline"></ion-icon>
                        <span>Quitar</span>
                      </button>
                    </div>
                  </div>
                </div>
              }

              @if (fileError()) {
                <div class="error-pill">
                  <ion-icon name="alert-circle-outline"></ion-icon>
                  <span>{{ fileError() }}</span>
                </div>
              }

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSubmittingProof() || !selectedFile()"
                  (click)="submitProof()"
                >
                  @if (isSubmittingProof()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    <ion-icon name="cloud-upload-outline" slot="start"></ion-icon>
                    Enviar Comprobante a Revisión
                  }
                </ion-button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>

      <!-- MODAL: VISOR DE COMPROBANTE (LIGHTBOX) -->
      <ion-modal [isOpen]="isReceiptViewerOpen()" (didDismiss)="closeReceiptViewer()">
        <ng-template>
          <div class="viewer-wrapper">
            <div class="viewer-header">
              <div class="viewer-info">
                <h3>Comprobante de Pago</h3>
                @if (selectedTxForViewer(); as tx) {
                  <p class="viewer-sub">
                    {{ tx.deudor.nombre_visible }} pagó a {{ tx.acreedor.nombre_visible }}
                  </p>
                }
              </div>
              <button class="close-btn" (click)="closeReceiptViewer()">✕</button>
            </div>

            <div class="viewer-body">
              @if (selectedTxForViewer(); as tx) {
                <div class="viewer-image-container">
                  <img
                    [src]="resolverUrl(tx.comprobante_url)"
                    alt="Comprobante bancario"
                    class="viewer-img"
                  />
                </div>
                <div class="viewer-footer">
                  <div class="viewer-amount">
                    <span class="label">Monto transferido:</span>
                    <span class="amount-val">{{ tx.monto_centavos | centavosADinero }}</span>
                  </div>
                  <a
                    [href]="resolverUrl(tx.comprobante_url)"
                    target="_blank"
                    class="btn-open-original"
                  >
                    <ion-icon name="open-outline"></ion-icon>
                    <span>Abrir en tamaño original</span>
                  </a>
                </div>
              }
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

    .settlement-content {
      --background: #080C14;
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
      padding: 36px 24px;
      background: #0E1626;
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      color: #94A3B8;

      .empty-icon-circle {
        font-size: 2.2rem;
        margin-bottom: 8px;
      }

      h4 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.1rem;
        font-weight: 700;
        color: #F8FAFC;
        margin: 0 0 6px;
      }

      p {
        font-size: 0.85rem;
        margin: 0;
      }
    }

    .tx-cards-stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .tx-flow-card {
      background: #0E1626;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 16px;
      transition: all 0.2s ease;

      &.settled {
        opacity: 0.65;
        border-color: rgba(16, 185, 129, 0.2);
        background: rgba(14, 22, 38, 0.6);
      }
    }

    .tx-parties-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .person-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 80px;

      .avatar-circle {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Outfit', sans-serif;
        font-weight: 800;
        font-size: 1.1rem;
        margin-bottom: 6px;
      }

      .person-name {
        font-size: 0.82rem;
        font-weight: 700;
        color: #F8FAFC;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 80px;
      }

      .person-role {
        font-size: 0.68rem;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    }

    .debtor-avatar {
      background: rgba(244, 63, 94, 0.15);
      color: #FB7185;
      border: 1px solid rgba(244, 63, 94, 0.3);
    }

    .creditor-avatar {
      background: rgba(16, 185, 129, 0.15);
      color: var(--ion-color-primary);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .amount-arrow-box {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 10px;

      .transfer-amount {
        font-family: 'Outfit', sans-serif;
        font-size: 1.15rem;
        font-weight: 800;
        color: #F8FAFC;
        margin-bottom: 2px;
      }

      .arrow-line {
        display: flex;
        align-items: center;
        color: #6366F1;
        font-size: 1.2rem;
      }
    }

    .tx-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      margin-bottom: 12px;
    }

    .receipt-pill-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.76rem;
      font-weight: 600;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #A5B4FC;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(99, 102, 241, 0.25);
        color: #FFFFFF;
      }
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

    /* Modal Subir Comprobante */
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
        font-size: 1.25rem;
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

    .header-title-box {
      display: flex;
      align-items: center;
      gap: 8px;

      .modal-title-icon {
        font-size: 1.3rem;
        color: var(--ion-color-primary);
      }
    }

    .modal-desc {
      color: #94A3B8;
      font-size: 0.85rem;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .dropzone-box {
      border: 2px dashed rgba(99, 102, 241, 0.4);
      background: rgba(15, 23, 42, 0.6);
      border-radius: 18px;
      padding: 32px 16px;
      text-align: center;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      transition: all 0.25s ease;

      &:hover, &.drag-over {
        border-color: var(--ion-color-primary);
        background: rgba(16, 185, 129, 0.08);
        transform: translateY(-2px);
      }

      .dropzone-icon-circle {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: rgba(99, 102, 241, 0.2);
        color: #818CF8;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.8rem;
        margin-bottom: 4px;
      }

      .dropzone-title {
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 0.95rem;
        color: #F8FAFC;
      }

      .dropzone-sub {
        font-size: 0.8rem;
        color: #94A3B8;
      }

      .dropzone-tags {
        display: flex;
        gap: 6px;
        margin-top: 8px;

        .badge-tag {
          font-size: 0.7rem;
          padding: 3px 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          color: #94A3B8;
        }
      }
    }

    .preview-card {
      background: #0E1626;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;

      .preview-image-wrap {
        width: 100%;
        max-height: 220px;
        background: #080C14;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;

        .preview-img {
          width: 100%;
          max-height: 220px;
          object-fit: contain;
        }
      }

      .preview-meta {
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;

        .meta-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;

          .file-name {
            font-size: 0.82rem;
            font-weight: 600;
            color: #F8FAFC;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 160px;
          }

          .file-size {
            font-size: 0.74rem;
            color: #94A3B8;
          }
        }

        .preview-actions {
          display: flex;
          gap: 6px;

          .action-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 10px;
            border-radius: 8px;
            font-size: 0.75rem;
            font-weight: 600;
            border: none;
            cursor: pointer;

            &.change-btn {
              background: rgba(99, 102, 241, 0.15);
              color: #A5B4FC;
            }

            &.remove-btn {
              background: rgba(239, 68, 68, 0.15);
              color: #F87171;
            }
          }
        }
      }
    }

    .error-pill {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #FCA5A5;
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .modal-actions {
      margin-top: 24px;
    }

    /* Lightbox Modal */
    .viewer-wrapper {
      background: #080C14;
      display: flex;
      flex-direction: column;
      height: 100%;
      color: #F8FAFC;
    }

    .viewer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);

      h3 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.15rem;
        font-weight: 700;
        margin: 0 0 2px;
      }

      .viewer-sub {
        font-size: 0.8rem;
        color: #94A3B8;
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

    .viewer-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px;
    }

    .viewer-image-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #020408;
      border-radius: 16px;
      overflow: hidden;
      min-height: 280px;

      .viewer-img {
        max-width: 100%;
        max-height: 60vh;
        object-fit: contain;
      }
    }

    .viewer-footer {
      margin-top: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;

      .viewer-amount {
        display: flex;
        flex-direction: column;

        .label {
          font-size: 0.75rem;
          color: #94A3B8;
        }

        .amount-val {
          font-family: 'Outfit', sans-serif;
          font-size: 1.25rem;
          font-weight: 800;
          color: var(--ion-color-primary);
        }
      }

      .btn-open-original {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #F8FAFC;
        text-decoration: none;
        font-size: 0.82rem;
        font-weight: 600;
        transition: background 0.2s;

        &:hover {
          background: rgba(255, 255, 255, 0.15);
        }
      }
    }
  `]
})
export class SettlementPage implements OnInit, ViewWillEnter {
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
  selectedFile = signal<File | null>(null);
  previewUrl = signal<string | null>(null);
  fileError = signal<string | null>(null);
  isSubmittingProof = signal<boolean>(false);
  isDragOver = signal<boolean>(false);

  // Viewer Modal (Lightbox)
  isReceiptViewerOpen = signal<boolean>(false);
  selectedTxForViewer = signal<TransaccionDTO | null>(null);

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
      timeOutline,
      imageOutline,
      cameraOutline,
      trashOutline,
      swapHorizontalOutline,
      openOutline
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.eventId.set(id);
      this.loadTransactions();
    }
  }

  ionViewWillEnter(): void {
    if (this.eventId()) {
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

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  resolverUrl(path: string | null | undefined): string {
    return this.api.resolverUrlComprobante(path);
  }

  openReceiptViewer(tx: TransaccionDTO): void {
    this.selectedTxForViewer.set(tx);
    this.isReceiptViewerOpen.set(true);
  }

  closeReceiptViewer(): void {
    this.isReceiptViewerOpen.set(false);
    this.selectedTxForViewer.set(null);
  }

  openProofModal(txId: string): void {
    this.activeTxIdForProof.set(txId);
    this.removeSelectedFile();
    this.fileError.set(null);
    this.isProofModalOpen.set(true);
  }

  closeProofModal(): void {
    this.isProofModalOpen.set(false);
    this.removeSelectedFile();
    this.fileError.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.handleFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  private handleFile(file: File): void {
    this.fileError.set(null);
    if (!file.type.startsWith('image/')) {
      this.fileError.set('Solo se permiten archivos de imagen (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.fileError.set('La imagen supera el límite máximo de 10 MB.');
      return;
    }

    if (this.previewUrl()) {
      URL.revokeObjectURL(this.previewUrl()!);
    }

    const objectUrl = URL.createObjectURL(file);
    this.selectedFile.set(file);
    this.previewUrl.set(objectUrl);
  }

  removeSelectedFile(): void {
    if (this.previewUrl()) {
      URL.revokeObjectURL(this.previewUrl()!);
    }
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.fileError.set(null);
  }

  submitProof(): void {
    const txId = this.activeTxIdForProof();
    const file = this.selectedFile();
    if (!txId || !file) return;

    this.isSubmittingProof.set(true);
    this.api.subirComprobante(txId, file).subscribe({
      next: () => {
        this.isSubmittingProof.set(false);
        this.closeProofModal();
        this.toastCtrl.create({
          message: '¡Comprobante subido exitosamente y enviado a revisión!',
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
        this.loadTransactions();
      },
      error: (err) => {
        this.isSubmittingProof.set(false);
        const msg = err?.error?.message || 'Error al subir el comprobante';
        this.fileError.set(msg);
      }
    });
  }
}
