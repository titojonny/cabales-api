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
import { forkJoin } from 'rxjs';
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
  openOutline,
  logoWhatsapp,
  copyOutline,
  shareSocialOutline,
  arrowBackOutline
} from 'ionicons/icons';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { AuthService } from '../../core/services/auth.service';
import { TransaccionDTO, EstadoTransaccion, EventoDetalleDTO } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { generarMensajeCobroWhatsApp, compartirTexto, copiarTextoAlPortapapeles } from '../../core/utils/whatsapp-share';

@Component({
  selector: 'app-settlement',
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
    CentavosADineroPipe,
    StatusBadgeComponent
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="cabales-toolbar">
        <div class="custom-nav-bar">
          <ion-buttons slot="start" class="nav-start">
            <ion-back-button [defaultHref]="'/events/' + eventId()" text="" color="light"></ion-back-button>
          </ion-buttons>
          <div class="nav-center-title">
            <span class="nav-title-text">Liquidación de Mesa</span>
          </div>
          <div class="nav-end">
            <button type="button" class="header-wa-pill" (click)="openWhatsAppModal()" title="Cobrar por WhatsApp">
              <ion-icon name="logo-whatsapp"></ion-icon>
              <span>Cobrar</span>
            </button>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="settlement-content" [fullscreen]="true">
      @if (isLoading()) {
        <div class="loading-box">
          <ion-spinner name="crescent" color="primary"></ion-spinner>
          <p>Calculando transferencias mínimas...</p>
        </div>
      } @else if (evento()) {
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

        <!-- Banner Interactivo de Cobro por WhatsApp -->
        <div class="whatsapp-cobro-banner" (click)="openWhatsAppModal()">
          <div class="wa-banner-left">
            <div class="wa-bubble-icon">
              <ion-icon name="logo-whatsapp"></ion-icon>
            </div>
            <div class="wa-banner-text">
              <span class="wa-banner-title">Cobrar al Grupo</span>
              <span class="wa-banner-subtitle">Envía el desglose de deudas y tu cuenta bancaria</span>
            </div>
          </div>
          <button type="button" class="wa-banner-btn">
            <span>Cobrar</span>
            <ion-icon name="arrow-forward-outline"></ion-icon>
          </button>
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
      } @else {
        <div class="error-state-card">
          <div class="error-icon-box">⚠️</div>
          <h3 class="error-title">No pudimos cargar la liquidación</h3>
          <p class="error-desc">Es posible que la mesa aún no esté cerrada o haya un problema de conexión.</p>
          <button type="button" class="btn-return-home" (click)="goToEventDetail()">
            <ion-icon name="arrow-back-outline"></ion-icon>
            <span>Volver a la Mesa</span>
          </button>
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

      <!-- MODAL DE COBRO POR WHATSAPP -->
      <ion-modal [isOpen]="isWhatsAppModalOpen()" (didDismiss)="closeWhatsAppModal()" class="cabales-modal whatsapp-cobro-modal">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <div class="assistant-header-text">
                <h2>Cobro por WhatsApp</h2>
                <span class="assistant-sub">Genera y envía el desglose de deudas al grupo</span>
              </div>
              <button type="button" class="close-btn" (click)="closeWhatsAppModal()">✕</button>
            </div>

            <div class="modal-body-content">
              <!-- Entrada de datos bancarios -->
              <div class="bank-details-group">
                <label class="input-label" for="bank-input">
                  Datos de transferencia o cuenta bancaria (opcional):
                </label>
                <textarea
                  id="bank-input"
                  class="bank-textarea"
                  rows="3"
                  placeholder="Ej: Banco Agrícola Cta. Ahorro: 000-000000-00 a nombre de Juan Pérez / Chivo Wallet: 7777-8888 / DUI: 00000000-0"
                  [value]="datosBancarios()"
                  (input)="onDatosBancariosChange($event)"
                ></textarea>
                <span class="input-hint">Estos datos se incluirán automáticamente en el mensaje de cobro.</span>
              </div>

              <!-- Preview del Mensaje -->
              <div class="wa-preview-section">
                <span class="preview-header-label">
                  <ion-icon name="logo-whatsapp"></ion-icon>
                  Vista previa del mensaje:
                </span>
                <div class="wa-chat-bubble">
                  <pre class="wa-message-text">{{ mensajeWhatsAppGenerado() }}</pre>
                </div>
              </div>

              <!-- Acciones de Enviar y Copiar -->
              <div class="wa-modal-actions">
                <button type="button" class="btn-send-whatsapp" (click)="sendWhatsApp()">
                  <ion-icon name="logo-whatsapp"></ion-icon>
                  <span>Abrir en WhatsApp</span>
                </button>
                <button type="button" class="btn-copy-message" (click)="copyWhatsAppMessage()">
                  <ion-icon name="copy-outline"></ion-icon>
                  <span>Copiar Mensaje</span>
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

    .header-wa-pill {
      background: rgba(37, 211, 102, 0.15);
      border: 1px solid rgba(37, 211, 102, 0.4);
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

      ion-icon {
        color: #25D366;
        font-size: 0.95rem;
      }

      &:active {
        transform: scale(0.95);
      }

      &:hover {
        background: rgba(37, 211, 102, 0.25);
      }
    }

    .settlement-content {
      --background: var(--ion-background-color);
      padding: 16px;
    }

    .loading-box {
      text-align: center;
      padding: 60px 20px;
      color: #BAC8B1;
    }

    .hero-settlement-card {
      background: linear-gradient(135deg, rgba(77, 190, 85, 0.15) 0%, rgba(113, 119, 109, 0.25) 100%);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 24px;
      padding: 24px 20px;
      margin: 12px 16px 24px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);

      &.all-settled {
        background: linear-gradient(135deg, rgba(121, 237, 145, 0.2) 0%, rgba(33, 38, 32, 0.8) 100%);
        border-color: #4DBE55;
      }
    }

    .settlement-icon-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(77, 190, 85, 0.2);
      color: #79ED91;
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
      color: #F1F1F1;
      margin: 0 0 6px;
    }

    .settlement-subline {
      font-size: 0.85rem;
      color: #BEBEBE;
      line-height: 1.4;
      margin: 0;

      strong {
        color: #F1F1F1;
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
      color: #F1F1F1;
      margin: 0;
    }

    .completed-counter {
      font-size: 0.78rem;
      font-weight: 600;
      color: #79ED91;
    }

    .empty-debts-box {
      text-align: center;
      padding: 36px 24px;
      background: #212620;
      border: 1px dashed rgba(113, 119, 109, 0.35);
      border-radius: 20px;
      color: #BEBEBE;

      .empty-icon-circle {
        font-size: 2.2rem;
        margin-bottom: 8px;
        color: #79ED91;
      }

      h4 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.1rem;
        font-weight: 700;
        color: #F1F1F1;
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
      background: rgba(33, 38, 32, 0.85);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 20px;
      padding: 16px;
      transition: all 0.2s ease;

      &.settled {
        opacity: 0.65;
        border-color: rgba(113, 119, 109, 0.25);
        background: rgba(0, 0, 0, 0.25);
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
        color: #F1F1F1;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 80px;
      }

      .person-role {
        font-size: 0.68rem;
        color: #BEBEBE;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    }

    .debtor-avatar {
      background: rgba(239, 68, 68, 0.16);
      color: #FCA5A5;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }

    .creditor-avatar {
      background: rgba(121, 237, 145, 0.16);
      color: #79ED91;
      border: 1px solid rgba(121, 237, 145, 0.4);
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
        color: #F1F1F1;
        margin-bottom: 2px;
      }

      .arrow-line {
        display: flex;
        align-items: center;
        color: #BEBEBE;
        font-size: 1.2rem;
      }
    }

    .tx-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 10px;
      border-top: 1px solid rgba(113, 119, 109, 0.25);
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
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #F1F1F1;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(113, 119, 109, 0.35);
        color: #F1F1F1;
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
      background: rgba(121, 237, 145, 0.16);
      border: 1px solid rgba(121, 237, 145, 0.4);
      color: #79ED91;
    }

    .btn-proof {
      background: rgba(105, 134, 150, 0.2);
      border: 1px solid rgba(105, 134, 150, 0.4);
      color: #F1F1F1;
    }

    .btn-confirm {
      background: #4DBE55;
      color: #141F14;
      font-weight: 800;
    }

    .btn-dispute {
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #FCA5A5;
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
      background: rgba(105, 134, 150, 0.18);
      border: 1px solid rgba(105, 134, 150, 0.35);
      color: #F1F1F1;
    }

    .dispute-alert-box {
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #FCA5A5;
    }

    .completed-check-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #79ED91;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 4px 0;
    }

    /* Modal Subir Comprobante */
    .modal-wrapper {
      background: #212620;
      padding: 24px;
      height: 100%;
      color: #F1F1F1;
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
        color: #F1F1F1;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: #BEBEBE;
        font-size: 1.2rem;
        cursor: pointer;

        &:hover {
          color: #F1F1F1;
        }
      }
    }

    .header-title-box {
      display: flex;
      align-items: center;
      gap: 8px;

      .modal-title-icon {
        font-size: 1.3rem;
        color: #4DBE55;
      }
    }

    .modal-desc {
      color: #BEBEBE;
      font-size: 0.85rem;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .dropzone-box {
      border: 2px dashed rgba(113, 119, 109, 0.45);
      background: rgba(0, 0, 0, 0.25);
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
        border-color: #4DBE55;
        background: rgba(77, 190, 85, 0.15);
        transform: translateY(-2px);
      }

      .dropzone-icon-circle {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: rgba(77, 190, 85, 0.16);
        color: #79ED91;
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
        color: #F1F1F1;
      }

      .dropzone-sub {
        font-size: 0.8rem;
        color: #BEBEBE;
      }

      .dropzone-tags {
        display: flex;
        gap: 6px;
        margin-top: 8px;

        .badge-tag {
          font-size: 0.7rem;
          padding: 3px 8px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(113, 119, 109, 0.35);
          color: #BEBEBE;
        }
      }
    }

    .preview-card {
      background: #212620;
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 16px;
      overflow: hidden;

      .preview-image-wrap {
        width: 100%;
        max-height: 220px;
        background: rgba(0, 0, 0, 0.3);
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
            color: #F1F1F1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 160px;
          }

          .file-size {
            font-size: 0.74rem;
            color: #BEBEBE;
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
              background: rgba(0, 0, 0, 0.25);
              border: 1px solid rgba(113, 119, 109, 0.35);
              color: #BEBEBE;
            }

            &.remove-btn {
              background: rgba(239, 68, 68, 0.16);
              border: 1px solid rgba(239, 68, 68, 0.4);
              color: #FCA5A5;
            }
          }
        }
      }
    }

    .error-pill {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.4);
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
      background: #212620;
      display: flex;
      flex-direction: column;
      height: 100%;
      color: #F1F1F1;
    }

    .viewer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(113, 119, 109, 0.3);

      h3 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.15rem;
        font-weight: 700;
        margin: 0 0 2px;
        color: #F1F1F1;
      }

      .viewer-sub {
        font-size: 0.8rem;
        color: #BEBEBE;
        margin: 0;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: #BEBEBE;
        font-size: 1.2rem;
        cursor: pointer;

        &:hover {
          color: #F1F1F1;
        }
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
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(113, 119, 109, 0.35);
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
          color: #BEBEBE;
        }

        .amount-val {
          font-family: 'Outfit', sans-serif;
          font-size: 1.25rem;
          font-weight: 800;
          color: #79ED91;
        }
      }

      .btn-open-original {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(113, 119, 109, 0.35);
        color: #F1F1F1;
        text-decoration: none;
        font-size: 0.82rem;
        font-weight: 600;
        transition: background 0.2s;

        &:hover {
          background: rgba(113, 119, 109, 0.35);
        }
      }
    }

    .header-wa-btn {
      --color: #25D366;
    }

    /* BANNER DE COBRO POR WHATSAPP */
    .whatsapp-cobro-banner {
      background: linear-gradient(135deg, rgba(37, 211, 102, 0.15) 0%, rgba(33, 38, 32, 0.9) 100%);
      border: 1px solid rgba(37, 211, 102, 0.4);
      border-radius: 20px;
      padding: 16px 18px;
      margin: 0 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      transition: transform 0.15s ease, border-color 0.2s ease;

      &:hover {
        border-color: #25D366;
        transform: translateY(-2px);
      }

      &:active {
        transform: scale(0.98);
      }
    }

    .wa-banner-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .wa-bubble-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #25D366;
      color: #141F14;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.35);
    }

    .wa-banner-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .wa-banner-title {
      font-family: 'Outfit', sans-serif;
      font-size: 0.98rem;
      font-weight: 800;
      color: #F1F1F1;
    }

    .wa-banner-subtitle {
      font-size: 0.76rem;
      color: #BEBEBE;
      line-height: 1.3;
    }

    .wa-banner-btn {
      background: rgba(37, 211, 102, 0.2);
      border: 1px solid rgba(37, 211, 102, 0.4);
      color: #79ED91;
      padding: 8px 14px;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease;

      &:hover {
        background: rgba(37, 211, 102, 0.3);
        color: #F1F1F1;
      }
    }

    /* MODAL DE COBRO POR WHATSAPP */
    .bank-details-group {
      margin-bottom: 20px;
    }

    .input-label {
      font-size: 0.8rem;
      font-weight: 700;
      color: #F1F1F1;
      display: block;
      margin-bottom: 8px;
    }

    .bank-textarea {
      width: 100%;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(113, 119, 109, 0.4);
      border-radius: 12px;
      color: #F1F1F1;
      padding: 12px;
      font-size: 0.85rem;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: #4DBE55;
        box-shadow: 0 0 0 2px rgba(77, 190, 85, 0.25);
      }

      &::placeholder {
        color: #71776D;
      }
    }

    .input-hint {
      font-size: 0.74rem;
      color: #BEBEBE;
      display: block;
      margin-top: 6px;
    }

    .wa-preview-section {
      margin-bottom: 24px;
    }

    .preview-header-label {
      font-size: 0.78rem;
      font-weight: 700;
      color: #BEBEBE;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;

      ion-icon {
        color: #25D366;
        font-size: 1rem;
      }
    }

    .wa-chat-bubble {
      background: #1B2B1B;
      border: 1px solid rgba(37, 211, 102, 0.3);
      border-radius: 16px;
      padding: 16px;
      max-height: 220px;
      overflow-y: auto;
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .wa-message-text {
      font-family: monospace;
      font-size: 0.8rem;
      color: #F1F1F1;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      line-height: 1.45;
    }

    .wa-modal-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
    }

    .btn-send-whatsapp {
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
      box-shadow: 0 4px 16px rgba(37, 211, 102, 0.35);
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

    .btn-copy-message {
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
export class SettlementPage implements OnInit, ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(CabalesApiService);
  private auth = inject(AuthService);
  private toastCtrl = inject(ToastController);

  eventId = signal<string>('');
  evento = signal<EventoDetalleDTO | null>(null);
  transactions = signal<TransaccionDTO[]>([]);
  isLoading = signal<boolean>(true);

  // WhatsApp Cobro Modal
  isWhatsAppModalOpen = signal<boolean>(false);
  datosBancarios = signal<string>('');
  mensajeWhatsAppGenerado = computed(() => {
    const ev = this.evento();
    if (!ev) return '';
    return generarMensajeCobroWhatsApp(ev, this.transactions(), this.datosBancarios());
  });

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
      openOutline,
      logoWhatsapp,
      copyOutline,
      shareSocialOutline,
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
      this.loadTransactions();
    }
  }

  loadTransactions(): void {
    const id = this.eventId();
    if (!id) return;

    this.isLoading.set(true);
    forkJoin({
      evento: this.api.obtenerDetalleEvento(id),
      transacciones: this.api.obtenerTransacciones(id)
    }).subscribe({
      next: ({ evento, transacciones }) => {
        this.evento.set(evento);
        this.transactions.set(transacciones || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  goToEventDetail(): void {
    this.router.navigate(['/events', this.eventId()]);
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

  // --- COBRO POR WHATSAPP ---

  openWhatsAppModal(): void {
    if (!this.datosBancarios()) {
      this.datosBancarios.set(this.auth.getDatosBancarios());
    }
    this.isWhatsAppModalOpen.set(true);
  }

  closeWhatsAppModal(): void {
    this.isWhatsAppModalOpen.set(false);
  }

  onDatosBancariosChange(event: any): void {
    const val = event.target.value || '';
    this.datosBancarios.set(val);
    this.auth.setDatosBancarios(val);
  }

  async sendWhatsApp(): Promise<void> {
    const texto = this.mensajeWhatsAppGenerado();
    if (!texto) return;
    const ev = this.evento();
    await compartirTexto(`Cobro Mesa Cabales: ${ev?.nombre || ''}`, texto);
  }

  async copyWhatsAppMessage(): Promise<void> {
    const texto = this.mensajeWhatsAppGenerado();
    if (!texto) return;
    const ok = await copiarTextoAlPortapapeles(texto);
    if (ok) {
      const toast = await this.toastCtrl.create({
        message: '¡Mensaje de cobro copiado al portapapeles!',
        duration: 2500,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    }
  }
}

