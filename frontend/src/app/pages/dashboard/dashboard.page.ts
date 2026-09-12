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
            <span class="brand-badge">⚡ MVP</span>
            <h1 class="brand-title">Cabales</h1>
          </div>
          <button type="button" class="user-pill" (click)="openUserModal()">
            <ion-icon name="person-circle-outline"></ion-icon>
            <span>{{ currentUser()?.nombre || 'Usuario' }}</span>
          </button>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="dashboard-content" [fullscreen]="true">
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
            <h3>No tienes mesas aquí</h3>
            <p>¡Crea una nueva salida con tus amigos para empezar a dividir gastos!</p>
            <ion-button color="primary" fill="outline" shape="round" (click)="openCreateModal()">
              + Crear Primera Salida
            </ion-button>
          </div>
        } @else {
          <div class="cards-grid">
            @for (evento of filteredEvents(); track evento.id) {
              <div class="event-card-item" (click)="goToEvent(evento.id)">
                <div class="event-card-top">
                  <div class="event-title-group">
                    <h3 class="event-title">{{ evento.nombre }}</h3>
                    <div class="event-meta">
                      <span class="meta-date">
                        <ion-icon name="time-outline"></ion-icon>
                        {{ evento.fecha | date:'d MMM y' }}
                      </span>
                      @if (evento.es_creador) {
                        <span class="creator-badge">Eres Organizador</span>
                      } @else {
                        <span class="guest-badge">Creado por {{ evento.creador.nombre }}</span>
                      }
                    </div>
                  </div>
                  <app-status-badge [status]="evento.estado"></app-status-badge>
                </div>

                <div class="event-card-divider"></div>

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
        <ion-fab-button (click)="openCreateModal()">
          <ion-icon name="add-outline"></ion-icon>
        </ion-fab-button>
      </ion-fab>

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

      <!-- Modal: Cambiar / Crear Usuario Activo -->
      <ion-modal [isOpen]="isUserModalOpen()" (didDismiss)="closeUserModal()">
        <ng-template>
          <div class="modal-wrapper">
            <div class="modal-header">
              <h2>Perfil / Usuario Activo</h2>
              <button class="close-btn" (click)="closeUserModal()">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-desc">
                Estás usando Cabales como:
              </p>
              <div class="current-user-card">
                <div class="user-avatar-large">
                  {{ currentUser()?.nombre?.charAt(0) || 'U' }}
                </div>
                <div>
                  <h4>{{ currentUser()?.nombre }}</h4>
                  <p>{{ currentUser()?.email }}</p>
                </div>
              </div>

              <h3 class="section-subheading">Crear o cambiar usuario de prueba:</h3>
              <ion-item class="cabales-input-item" lines="none">
                <ion-input
                  label="Nombre"
                  labelPlacement="stacked"
                  placeholder="Ej. Carlos"
                  [value]="switchUserName()"
                  (ionInput)="switchUserName.set($any($event.target).value)"
                ></ion-input>
              </ion-item>
              <ion-item class="cabales-input-item" lines="none">
                <ion-input
                  label="Email"
                  labelPlacement="stacked"
                  type="email"
                  placeholder="carlos@example.com"
                  [value]="switchUserEmail()"
                  (ionInput)="switchUserEmail.set($any($event.target).value)"
                ></ion-input>
              </ion-item>

              <div class="modal-actions">
                <ion-button
                  expand="block"
                  color="secondary"
                  shape="round"
                  [disabled]="!switchUserName().trim() || !switchUserEmail().trim()"
                  (click)="registerAndSwitchUser()"
                >
                  Registrar y Cambiar Persona
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
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
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
      color: #F8FAFC;
      margin: 0;
      letter-spacing: -0.03em;
    }

    .user-pill {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #F1F5F9;
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
        color: var(--ion-color-primary);
      }
    }

    .dashboard-content {
      --background: #0B0F19;
      padding: 16px;
    }

    .hero-stats-card {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 24px;
      padding: 24px 20px;
      margin: 8px 16px 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .stats-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .stats-label {
      font-size: 0.85rem;
      color: #94A3B8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .active-tables-pill {
      background: rgba(16, 185, 129, 0.2);
      color: #34D399;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 9999px;
    }

    .stats-amount {
      font-size: 2.75rem;
      font-weight: 800;
      color: #F8FAFC;
      line-height: 1.1;
      margin-bottom: 8px;
    }

    .stats-subtext {
      font-size: 0.82rem;
      color: #64748B;
    }

    .segment-wrapper {
      padding: 0 16px 16px;

      ion-segment {
        --background: rgba(255, 255, 255, 0.05);
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
      background: #151D30;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 20px;
      padding: 16px 18px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:active {
        transform: scale(0.985);
        background: #1A243C;
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
      color: #F8FAFC;
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
      color: #94A3B8;
    }

    .creator-badge {
      background: rgba(99, 102, 241, 0.15);
      color: #818CF8;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .guest-badge {
      background: rgba(255, 255, 255, 0.05);
      color: #94A3B8;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .event-card-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
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
      color: #94A3B8;

      ion-icon {
        color: var(--ion-color-secondary-tint);
      }
    }

    .event-spending {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .spending-label {
      font-size: 0.75rem;
      color: #64748B;
    }

    .spending-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--ion-color-primary);
    }

    .loading-state, .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #94A3B8;
    }

    .empty-icon-box {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      color: var(--ion-color-primary);
      font-size: 1.8rem;
    }

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
        font-size: 1.4rem;
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
      font-size: 0.9rem;
      margin-bottom: 20px;
      line-height: 1.4;
    }

    .current-user-card {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 12px 16px;
      margin-bottom: 24px;

      h4 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }

      p {
        margin: 2px 0 0;
        font-size: 0.8rem;
        color: #94A3B8;
      }
    }

    .user-avatar-large {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10B981 0%, #6366F1 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.2rem;
      color: #ffffff;
    }

    .section-subheading {
      font-size: 0.9rem;
      font-weight: 700;
      margin: 16px 0 10px;
      color: #E2E8F0;
    }

    .modal-actions {
      margin-top: 24px;
    }
  `]
})
export class DashboardPage implements OnInit {
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

  isUserModalOpen = signal<boolean>(false);
  switchUserName = signal<string>('');
  switchUserEmail = signal<string>('');

  activeEvents = computed(() => this.events().filter((e) => e.estado === 'ACTIVO'));
  closedEvents = computed(() => this.events().filter((e) => e.estado === 'CERRADO'));

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
    this.ensureUserAndLoadEvents();
  }

  private ensureUserAndLoadEvents(): void {
    const user = this.currentUser();
    if (!user || !user.id || user.id === 'default-user-id') {
      // Registrar usuario de desarrollo por defecto si aún no existe
      this.api.crearUsuario('Jonathan', 'jonathan@ufg.edu.sv').subscribe({
        next: (created) => {
          this.auth.setCurrentUser(created);
          this.loadEvents(created.id);
        },
        error: () => {
          // Si ya existe (409) o error, intentar cargar
          this.loadEvents(this.currentUserId());
        }
      });
    } else {
      this.loadEvents(user.id);
    }
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
        this.goToEvent(created.id);
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }

  openUserModal(): void {
    this.switchUserName.set('');
    this.switchUserEmail.set('');
    this.isUserModalOpen.set(true);
  }

  closeUserModal(): void {
    this.isUserModalOpen.set(false);
  }

  registerAndSwitchUser(): void {
    const name = this.switchUserName().trim();
    const email = this.switchUserEmail().trim();
    if (!name || !email) return;

    this.api.crearUsuario(name, email).subscribe({
      next: (user) => {
        this.auth.setCurrentUser(user);
        this.closeUserModal();
        this.loadEvents(user.id);
        this.toast.create({
          message: `Cambiado a usuario ${name}`,
          duration: 2000,
          color: 'success'
        }).then((t) => t.present());
      }
    });
  }
}
