import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButton,
  IonIcon,
  IonFab,
  IonFabButton,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  IonModal,
  IonItem,
  IonInput,
  ToastController,
  ViewWillEnter
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  refreshOutline,
  walletOutline,
  peopleOutline,
  lockClosedOutline,
  sparklesOutline,
  personCircleOutline,
  chevronForwardOutline,
  timeOutline
} from 'ionicons/icons';
import { CabalesApiService } from '../../core/services/cabales-api.service';
import { AuthService } from '../../core/services/auth.service';
import { EventoUsuarioItemDTO, UsuarioDTO } from '../../core/models/cabales.models';
import { CentavosADineroPipe } from '../../shared/pipes/centavos-a-dinero.pipe';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonButton,
    IonIcon,
    IonFab,
    IonFabButton,
    IonSegment,
    IonSegmentButton,
    IonLabel,
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
        <div class="header-container">
          <div class="brand-section">
            <span class="brand-badge">⚡ CABALES</span>
            <h1 class="brand-title">Cabales</h1>
          </div>
          @if (currentUser()) {
            <button type="button" class="user-pill" (click)="openUserModal()">
              <ion-icon name="person-circle-outline"></ion-icon>
              <span>{{ currentUser()?.nombre }}</span>
            </button>
          }
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="dashboard-content" [fullscreen]="true">
      @if (!currentUser()) {
        <!-- PANTALLA DE BIENVENIDA / FIRST-RUN (CERO FRICCIÓN) -->
        <div class="welcome-container">
          <div class="welcome-hero">
            <div class="welcome-badge">
              <ion-icon name="sparkles-outline"></ion-icon>
              <span>Bienvenido a Cabales</span>
            </div>
            <h1 class="welcome-headline">Divide tus salidas sin que sobre ni falte un centavo</h1>
            <p class="welcome-lead">
              Gastos compartidos en restaurantes, propinas automáticas y cobros por WhatsApp sin fórmulas ni enredos.
            </p>
          </div>

          <div class="onboarding-card">
            <h3 class="onboarding-card-title">¿Cómo te llamas?</h3>
            <p class="onboarding-card-desc">Escribe tu nombre o apodo para empezar a organizar mesas:</p>

            <ion-item class="cabales-input-item" lines="none">
              <ion-input
                placeholder="Ej. Jonathan, Carlos, Vale"
                [value]="welcomeName()"
                (ionInput)="welcomeName.set($any($event.target).value)"
                (keyup.enter)="startOnboarding()"
              ></ion-input>
            </ion-item>

            <ion-button
              expand="block"
              class="cabales-primary-btn"
              [disabled]="isStartingOnboarding() || !welcomeName().trim()"
              (click)="startOnboarding()"
            >
              @if (isStartingOnboarding()) {
                <ion-spinner name="crescent"></ion-spinner>
              } @else {
                Empezar ahora ➔
              }
            </ion-button>

            <div class="join-divider">
              <span>¿TE PASARON EL ENLACE DE UNA MESA?</span>
            </div>

            <div class="join-quick-group">
              <ion-item class="cabales-input-item join-input" lines="none">
                <ion-input
                  placeholder="Pega el enlace o código de mesa"
                  [value]="joinTableInput()"
                  (ionInput)="joinTableInput.set($any($event.target).value)"
                  (keyup.enter)="joinTableViaInput()"
                ></ion-input>
              </ion-item>
              <button
                type="button"
                class="btn-join-quick"
                [disabled]="!joinTableInput().trim()"
                (click)="joinTableViaInput()"
              >
                Ir a la mesa ➔
              </button>
            </div>
          </div>
        </div>
      } @else {
        <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
          <ion-refresher-content></ion-refresher-content>
        </ion-refresher>

        <!-- Global Spending Card -->
        <div class="hero-stats-card">
          <div class="stats-top">
            <span class="stats-label">Total en Salidas Activas</span>
            <span class="active-tables-pill">{{ activeEvents().length }} mesas abiertas</span>
          </div>
          <div class="stats-amount tabular-nums">
            {{ totalActiveSpending() | centavosADinero }}
          </div>
          <div class="stats-subtext">
            <span>Gastos compartidos sin que sobre ni falte un centavo</span>
          </div>
        </div>

        <!-- Segment Filter -->
        <div class="segment-wrapper">
          <ion-segment [value]="selectedFilter()" (ionChange)="onFilterChange($event)" mode="ios">
            <ion-segment-button value="ACTIVOS">
              <ion-label>Mesas Activas ({{ activeEvents().length }})</ion-label>
            </ion-segment-button>
            <ion-segment-button value="CERRADOS">
              <ion-label>Histórico ({{ closedEvents().length }})</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>

        <!-- Events List -->
        <div class="events-list-section">
          @if (isLoading()) {
            <div class="loading-state">
              <ion-spinner name="crescent" color="primary"></ion-spinner>
              <p>Cargando tus salidas...</p>
            </div>
          } @else if (filteredEvents().length === 0) {
            <div class="empty-state">
              <div class="empty-icon-box">
                <ion-icon name="sparkles-outline"></ion-icon>
              </div>
              <h3>{{ selectedFilter() === 'ACTIVOS' ? 'No tienes mesas activas ni cobros pendientes' : 'No tienes mesas en el histórico' }}</h3>
              <p>{{ selectedFilter() === 'ACTIVOS' ? '¡Crea una nueva salida con tus amigos para empezar a dividir gastos!' : 'Las mesas 100% saldadas aparecerán aquí una vez que todos estén cabales.' }}</p>
              @if (selectedFilter() === 'ACTIVOS') {
                <ion-button color="primary" fill="outline" shape="round" (click)="openCreateModal()">
                  + Crear Primera Salida
                </ion-button>
              }
            </div>
          } @else {
            <div class="cards-grid">
              @for (evento of filteredEvents(); track evento.id) {
                <div class="event-card-item" (click)="goToEvent(evento.id)">
                  <div class="event-card-top">
                    <div class="event-title-group">
                      <h3 class="event-title">{{ evento.nombre }}</h3>
                      <div class="event-meta">
                        <span class="event-date">
                          <ion-icon name="time-outline"></ion-icon>
                          {{ evento.fecha | date:'d MMM y' }}
                        </span>
                        @if (evento.es_creador) {
                          <span class="role-badge creator">Eres Organizador</span>
                        } @else {
                          <span class="role-badge guest">Invitado</span>
                        }
                      </div>
                    </div>
                    <div class="event-status-badge">
                      @if (evento.estado === 'ACTIVO') {
                        <app-status-badge [status]="evento.estado"></app-status-badge>
                      } @else {
                        <span class="settled-pill" [class.saldado]="evento.esta_saldado" [class.pendiente]="!evento.esta_saldado">
                          {{ evento.esta_saldado ? '✓ 100% Saldada' : '⏳ Deudas Pendientes' }}
                        </span>
                      }
                    </div>
                  </div>

                  <div class="event-card-bottom">
                    <div class="event-people-count">
                      <ion-icon name="people-outline"></ion-icon>
                      <span>{{ evento.numero_comensales }} comensales</span>
                    </div>
                    <div class="event-spending">
                      <span class="spending-label">Total gastado:</span>
                      <span class="spending-value tabular-nums">
                        {{ evento.total_gastado_centavos | centavosADinero }}
                      </span>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- FAB to Create Event -->
        <ion-fab slot="fixed" vertical="bottom" horizontal="end">
          <ion-fab-button class="cabales-fab" (click)="openCreateModal()">
            <ion-icon name="add-outline"></ion-icon>
          </ion-fab-button>
        </ion-fab>
      }

      <!-- Modal: Crear Salida -->
      <ion-modal [isOpen]="isCreateModalOpen()" (didDismiss)="closeCreateModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Nueva Salida</h2>
              <button class="close-btn" (click)="closeCreateModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-desc">
                Crea una mesa para ti y tus amigos. Podrás agregar comensales y consumos al instante.
              </p>

              <ion-item class="cabales-input-item" lines="none">
                <ion-input
                  label="Nombre de la salida"
                  labelPlacement="stacked"
                  placeholder="Ej. Alitas con los de la U"
                  [value]="newEventName()"
                  (ionInput)="onNewEventNameInput($event)"
                ></ion-input>
              </ion-item>

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="primary"
                  shape="round"
                  [disabled]="isSubmitting() || !newEventName().trim()"
                  (click)="submitCreateEvent()"
                >
                  @if (isSubmitting()) {
                    <ion-spinner name="dots"></ion-spinner>
                  } @else {
                    Crear Salida y Sentar Mesa
                  }
                </ion-button>
              </div>
            </div>
          </div>
        </ng-template>
      </ion-modal>

      <!-- Modal: Perfil y Gestión de Cuenta -->
      <ion-modal [isOpen]="isUserModalOpen()" (didDismiss)="closeUserModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Mi Perfil</h2>
              <button class="close-btn" (click)="closeUserModal()">✕</button>
            </div>
            <div class="modal-body">
              <div class="current-user-card">
                <div class="user-avatar-large">
                  {{ currentUser()?.nombre?.charAt(0) || 'U' }}
                </div>
                <div class="current-user-info">
                  <h4>{{ currentUser()?.nombre }}</h4>
                  <p>{{ currentUser()?.email }}</p>
                </div>
              </div>

              <div class="profile-edit-section">
                <span class="section-subheading">Editar Datos Personales:</span>
                <ion-item class="cabales-input-item" lines="none">
                  <ion-input
                    label="Nombre o Apodo"
                    labelPlacement="stacked"
                    placeholder="Ej. Jonathan"
                    [value]="editProfileName()"
                    (ionInput)="editProfileName.set($any($event.target).value)"
                  ></ion-input>
                </ion-item>

                <ion-item class="cabales-input-item" lines="none">
                  <ion-input
                    label="Datos Bancarios por defecto (para cobrar por WhatsApp)"
                    labelPlacement="stacked"
                    placeholder="Ej. BAC 12345678, Banco Agrícola o Chivo @usuario"
                    [value]="editProfileBankDetails()"
                    (ionInput)="editProfileBankDetails.set($any($event.target).value)"
                  ></ion-input>
                </ion-item>

                <ion-button
                  expand="block"
                  class="cabales-primary-btn"
                  [disabled]="isSavingProfile() || !editProfileName().trim()"
                  (click)="saveUserProfile()"
                >
                  @if (isSavingProfile()) {
                    <ion-spinner name="crescent"></ion-spinner>
                  } @else {
                    Guardar Cambios
                  }
                </ion-button>
              </div>

              @if (availableUsers().length > 1) {
                <div class="switch-account-section">
                  <span class="section-subheading">Cambiar a otra cuenta en este dispositivo:</span>
                  <div class="accounts-chip-list">
                    @for (u of availableUsers(); track u.id) {
                      @if (u.id !== currentUserId()) {
                        <button type="button" class="account-pill-btn" (click)="switchToExistingUser(u)">
                          <span>👤 {{ u.nombre }}</span>
                        </button>
                      }
                    }
                  </div>
                </div>
              }

              <div class="logout-section">
                <button type="button" class="btn-logout-link" (click)="logoutUser()">
                  Cerrar sesión en este dispositivo
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
      --border-width: 0;
      padding: 8px 16px;
    }

    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .brand-badge {
      background: rgba(77, 190, 85, 0.16);
      color: #79ED91;
      border: 1px solid rgba(77, 190, 85, 0.35);
      font-size: 0.65rem;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 6px;
      letter-spacing: 0.05em;
    }

    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.6rem;
      font-weight: 800;
      color: #F1F1F1;
      margin: 0;
      letter-spacing: -0.03em;
    }

    .user-pill {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #F1F1F1;
      border-radius: 9999px;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;

      ion-icon {
        font-size: 1.1rem;
        color: #79ED91;
      }
    }

    .dashboard-content {
      --background: var(--ion-background-color);
      padding: 16px;
    }

    .hero-stats-card {
      background: rgba(33, 38, 32, 0.85);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 24px;
      padding: 24px 20px;
      margin: 8px 16px 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .stats-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .stats-label {
      font-size: 0.85rem;
      color: #BEBEBE;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .active-tables-pill {
      background: rgba(77, 190, 85, 0.2);
      color: #79ED91;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 9999px;
      border: 1px solid #4DBE55;
    }

    .stats-amount {
      font-size: 2.75rem;
      font-weight: 800;
      color: #F1F1F1;
      line-height: 1.1;
      margin-bottom: 8px;
    }

    .stats-subtext {
      font-size: 0.82rem;
      color: #BEBEBE;
    }

    .segment-wrapper {
      padding: 0 16px 16px;

      ion-segment {
        --background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(113, 119, 109, 0.35);
        border-radius: 14px;
        padding: 4px;
      }
    }

    .events-list-section {
      padding: 0 16px 80px;
    }

    .cards-grid {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .event-card-item {
      background: rgba(33, 38, 32, 0.75);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 20px;
      padding: 16px 18px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:active {
        transform: scale(0.985);
        background: rgba(33, 38, 32, 0.95);
      }
    }

    .event-card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .event-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.15rem;
      font-weight: 700;
      color: #F1F1F1;
      margin: 0 0 6px;
    }

    .event-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .meta-date {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      color: #BEBEBE;
    }

    .creator-badge {
      background: rgba(77, 190, 85, 0.16);
      color: #79ED91;
      border: 1px solid rgba(77, 190, 85, 0.35);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .guest-badge {
      background: rgba(0, 0, 0, 0.25);
      color: #BEBEBE;
      border: 1px solid rgba(113, 119, 109, 0.35);
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .pending-tx-badge {
      font-size: 0.68rem;
      font-weight: 700;
      color: #FCA5A5;
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.4);
      padding: 2px 7px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
    }

    .event-card-divider {
      height: 1px;
      background: rgba(113, 119, 109, 0.3);
      margin: 14px 0 12px;
    }

    .event-card-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .event-people-count {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: #BEBEBE;

      ion-icon {
        color: #BEBEBE;
      }
    }

    .event-spending {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .spending-label {
      font-size: 0.75rem;
      color: #BEBEBE;
    }

    .spending-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: #F1F1F1;
    }

    .history-badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;

      &.saldado {
        background: rgba(121, 237, 145, 0.16);
        color: #79ED91;
        border: 1px solid rgba(121, 237, 145, 0.4);
      }

      &.pendiente {
        background: rgba(239, 68, 68, 0.16);
        color: #FCA5A5;
        border: 1px solid rgba(239, 68, 68, 0.4);
      }
    }

    .loading-state, .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #BEBEBE;
    }

    .empty-icon-box {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(77, 190, 85, 0.15);
      border: 1px solid rgba(77, 190, 85, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      color: #79ED91;
      font-size: 1.8rem;
    }

    .modal-wrapper {
      background: #212620;
      padding: 24px;
      height: 100%;
      color: #F1F1F1;
      border: 1px solid rgba(113, 119, 109, 0.35);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;

      h2 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.4rem;
        font-weight: 800;
        color: #F1F1F1;
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

    .modal-desc {
      color: #BEBEBE;
      font-size: 0.9rem;
      margin-bottom: 20px;
      line-height: 1.4;
    }

    .current-user-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 14px;
      padding: 12px 16px;
      margin-bottom: 24px;

      h4 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        color: #F1F1F1;
      }

      p {
        margin: 2px 0 0;
        font-size: 0.8rem;
        color: #BEBEBE;
      }
    }

    .user-avatar-large {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #4DBE55;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.2rem;
      color: #141F14;
    }

    .section-subheading {
      font-size: 0.9rem;
      font-weight: 700;
      margin: 16px 0 10px;
      color: #F1F1F1;
    }

    .welcome-container {
      max-width: 520px;
      margin: 24px auto;
      padding: 0 16px 40px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .welcome-hero {
      text-align: center;
      padding: 10px 0;
    }

    .welcome-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(77, 190, 85, 0.16);
      color: #79ED91;
      border: 1px solid rgba(77, 190, 85, 0.35);
      border-radius: 9999px;
      padding: 4px 14px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 16px;

      ion-icon {
        font-size: 1rem;
      }
    }

    .welcome-headline {
      font-family: 'Outfit', sans-serif;
      font-size: 2.1rem;
      font-weight: 800;
      color: #F1F1F1;
      line-height: 1.18;
      letter-spacing: -0.03em;
      margin: 0 0 12px;
    }

    .welcome-lead {
      font-size: 0.95rem;
      color: #BEBEBE;
      line-height: 1.5;
      margin: 0 auto;
    }

    .onboarding-card {
      background: rgba(33, 38, 32, 0.85);
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
    }

    .onboarding-card-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 700;
      color: #F1F1F1;
      margin: 0 0 4px;
    }

    .onboarding-card-desc {
      font-size: 0.88rem;
      color: #BEBEBE;
      margin: 0 0 16px;
    }

    .cabales-input-item {
      --background: rgba(0, 0, 0, 0.35);
      --border-radius: 12px;
      --padding-start: 12px;
      --padding-end: 12px;
      --color: #F1F1F1;
      --placeholder-color: #7A8077;
      border: 1px solid rgba(113, 119, 109, 0.35);
      border-radius: 12px;
      margin-bottom: 12px;
    }

    .cabales-primary-btn {
      --background: #4DBE55;
      --color: #141F14;
      font-weight: 800;
      font-size: 0.95rem;
      border-radius: 9999px;
      height: 46px;
      margin-top: 10px;
    }

    .join-divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 24px 0 16px;
      color: #7A8077;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;

      &::before, &::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid rgba(113, 119, 109, 0.25);
      }

      span {
        padding: 0 10px;
      }
    }

    .join-quick-group {
      display: flex;
      flex-direction: column;
      gap: 10px;

      .join-input {
        margin-bottom: 0;
      }
    }

    .btn-join-quick {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(113, 119, 109, 0.4);
      color: #F1F1F1;
      font-weight: 600;
      font-size: 0.88rem;
      padding: 10px 16px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        border-color: #79ED91;
        color: #79ED91;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .profile-edit-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 20px;
    }

    .switch-account-section {
      margin-bottom: 20px;
      padding-top: 14px;
      border-top: 1px solid rgba(113, 119, 109, 0.25);
    }

    .accounts-chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .account-pill-btn {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(113, 119, 109, 0.35);
      color: #F1F1F1;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 9999px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;

      &:hover {
        border-color: #79ED91;
        background: rgba(77, 190, 85, 0.15);
      }
    }

    .logout-section {
      text-align: center;
      padding-top: 10px;
    }

    .btn-logout-link {
      background: transparent;
      border: none;
      color: #FCA5A5;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      padding: 6px;

      &:hover {
        color: #EF4444;
      }
    }

    .modal-actions {
      margin-top: 24px;
    }
  `]
})
export class DashboardPage implements OnInit, ViewWillEnter {
  private api = inject(CabalesApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  readonly currentUser = this.auth.currentUser;
  readonly currentUserId = this.auth.currentUserId;

  events = signal<EventoUsuarioItemDTO[]>([]);
  isLoading = signal<boolean>(true);
  selectedFilter = signal<'ACTIVOS' | 'CERRADOS'>('ACTIVOS');

  isCreateModalOpen = signal<boolean>(false);
  newEventName = signal<string>('');
  isSubmitting = signal<boolean>(false);

  // Onboarding first-run
  welcomeName = signal<string>('');
  isStartingOnboarding = signal<boolean>(false);
  joinTableInput = signal<string>('');

  // Perfil modal
  isUserModalOpen = signal<boolean>(false);
  editProfileName = signal<string>('');
  editProfileBankDetails = signal<string>('');
  isSavingProfile = signal<boolean>(false);
  availableUsers = signal<UsuarioDTO[]>([]);

  activeEvents = computed(() => {
    return this.events().filter((e) => e.estado === 'ACTIVO' || !e.esta_saldado);
  });
  closedEvents = computed(() => {
    return this.events().filter((e) => e.estado === 'CERRADO' && e.esta_saldado);
  });

  filteredEvents = computed(() => {
    return this.selectedFilter() === 'ACTIVOS' ? this.activeEvents() : this.closedEvents();
  });

  totalActiveSpending = computed(() => {
    return this.activeEvents().reduce((sum, e) => sum + e.total_gastado_centavos, 0);
  });

  constructor() {
    addIcons({
      addOutline,
      refreshOutline,
      walletOutline,
      peopleOutline,
      lockClosedOutline,
      sparklesOutline,
      personCircleOutline,
      chevronForwardOutline,
      timeOutline
    });
  }

  ngOnInit(): void {
    // La carga se realiza en ionViewWillEnter
  }

  ionViewWillEnter(): void {
    this.ensureUserAndLoadEvents();
  }

  private ensureUserAndLoadEvents(): void {
    const user = this.currentUser();
    if (user && user.id) {
      this.loadEvents(user.id);
    } else {
      this.isLoading.set(false);
    }
  }

  startOnboarding(): void {
    const name = this.welcomeName().trim();
    if (!name) return;

    this.isStartingOnboarding.set(true);
    this.auth.registerOrLogin(name).subscribe({
      next: (user) => {
        this.isStartingOnboarding.set(false);
        this.loadEvents(user.id);
        this.toast.create({
          message: `¡Bienvenido a Cabales, ${user.nombre}!`,
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
      },
      error: (err) => {
        this.isStartingOnboarding.set(false);
        this.toast.create({
          message: 'No se pudo iniciar sesión: ' + (err.error?.error || err.message || 'Error desconocido'),
          duration: 3000,
          color: 'danger'
        }).then((t) => t.present());
      }
    });
  }

  joinTableViaInput(): void {
    const input = this.joinTableInput().trim();
    if (!input) return;

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = input.match(uuidRegex);
    const eventId = match ? match[0] : input;

    this.router.navigate(['/events', eventId]);
  }

  loadEvents(userId?: string): void {
    const id = userId || this.currentUserId();
    if (!id) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.api.obtenerEventosUsuario(id).subscribe({
      next: (data) => {
        this.events.set(data || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  handleRefresh(event: any): void {
    this.loadEvents();
    event.target.complete();
  }

  onFilterChange(event: any): void {
    this.selectedFilter.set(event.detail.value);
  }

  goToEvent(eventId: string): void {
    this.router.navigate(['/events', eventId]);
  }

  openCreateModal(): void {
    this.newEventName.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  onNewEventNameInput(event: any): void {
    this.newEventName.set(event.target.value || '');
  }

  submitCreateEvent(): void {
    const name = this.newEventName().trim();
    const userId = this.currentUserId();
    if (!name || !userId) return;

    this.isSubmitting.set(true);
    this.api.crearEvento(name, userId).subscribe({
      next: (created) => {
        this.isSubmitting.set(false);
        this.closeCreateModal();
        setTimeout(() => {
          this.goToEvent(created.id);
        }, 180);
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }

  openUserModal(): void {
    const user = this.currentUser();
    if (user) {
      this.editProfileName.set(user.nombre);
    }
    this.editProfileBankDetails.set(this.auth.getDatosBancarios());
    this.api.obtenerUsuarios().subscribe({
      next: (users) => this.availableUsers.set(users || []),
      error: () => this.availableUsers.set([])
    });
    this.isUserModalOpen.set(true);
  }

  closeUserModal(): void {
    this.isUserModalOpen.set(false);
  }

  saveUserProfile(): void {
    const name = this.editProfileName().trim();
    if (!name) return;

    this.isSavingProfile.set(true);
    this.auth.updateCurrentUserName(name).subscribe({
      next: () => {
        this.auth.setDatosBancarios(this.editProfileBankDetails());
        this.isSavingProfile.set(false);
        this.closeUserModal();
        this.toast.create({
          message: 'Perfil y datos de cobro actualizados',
          duration: 2500,
          color: 'success'
        }).then((t) => t.present());
      },
      error: (err) => {
        this.isSavingProfile.set(false);
        this.toast.create({
          message: 'Error al actualizar perfil: ' + (err.error?.error || err.message || 'Error desconocido'),
          duration: 3000,
          color: 'danger'
        }).then((t) => t.present());
      }
    });
  }

  switchToExistingUser(user: UsuarioDTO): void {
    this.auth.setCurrentUser(user);
    this.closeUserModal();
    this.loadEvents(user.id);
    this.toast.create({
      message: `Cambiado a ${user.nombre}`,
      duration: 2000,
      color: 'success'
    }).then((t) => t.present());
  }

  logoutUser(): void {
    this.auth.logout();
    this.events.set([]);
    this.closeUserModal();
    this.toast.create({
      message: 'Sesión cerrada en este dispositivo',
      duration: 2000,
      color: 'medium'
    }).then((t) => t.present());
  }
}
