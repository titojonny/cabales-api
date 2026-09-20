import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, tap, switchMap, of } from 'rxjs';
import { UsuarioDTO } from '../models/cabales.models';
import { CabalesApiService } from './cabales-api.service';

const STORAGE_KEY_USER = 'cabales_active_user';
const STORAGE_KEY_BANK = 'cabales_default_bank_details';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private api = inject(CabalesApiService);

  // Usuario activo reactivo con Angular Signals
  private currentUserSignal = signal<UsuarioDTO | null>(this.loadStoredUser());

  readonly currentUser = computed(() => this.currentUserSignal());
  readonly currentUserId = computed(() => this.currentUserSignal()?.id || '');
  readonly currentUserName = computed(() => this.currentUserSignal()?.nombre || '');
  readonly isLoggedIn = computed(() => !!this.currentUserSignal());

  private loadStoredUser(): UsuarioDTO | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_USER);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id && parsed.id !== 'default-user-id') {
          return parsed;
        }
      }
    } catch {
      // Ignorar errores de localStorage
    }
    return null;
  }

  setCurrentUser(user: UsuarioDTO): void {
    this.currentUserSignal.set(user);
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    } catch {
      // fallback
    }
  }

  logout(): void {
    this.currentUserSignal.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY_USER);
    } catch {
      // fallback
    }
  }

  /**
   * Registro rápido o inicio de sesión sin contraseñas:
   * Si ya existe un usuario con ese nombre en la base de datos, lo asocia.
   * Si no, lo crea de forma limpia con un email amigable.
   */
  registerOrLogin(nombre: string): Observable<UsuarioDTO> {
    const trimmed = nombre.trim();
    if (!trimmed) {
      throw new Error('El nombre no puede estar vacío');
    }

    return this.api.obtenerUsuarios().pipe(
      switchMap((usuarios) => {
        const existente = usuarios.find(
          (u) => u.nombre.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (existente) {
          return of(existente);
        }

        const safeSlug = trimmed
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.random().toString(36).substring(2, 6);
        const email = `${safeSlug || 'comensal'}.${randomSuffix}@cabales.app`;

        return this.api.crearUsuario(trimmed, email);
      }),
      tap((usuario) => {
        this.setCurrentUser(usuario);
      })
    );
  }

  /**
   * Actualiza el nombre del perfil actual en PostgreSQL y en la sesión local
   */
  updateCurrentUserName(nuevoNombre: string): Observable<UsuarioDTO> {
    const userId = this.currentUserId();
    const trimmed = nuevoNombre.trim();
    if (!userId || !trimmed) {
      throw new Error('No hay usuario activo o el nombre es inválido');
    }

    return this.api.actualizarUsuario(userId, { nombre: trimmed }).pipe(
      tap((usuarioActualizado) => {
        this.setCurrentUser(usuarioActualizado);
      })
    );
  }

  /**
   * Datos bancarios por defecto guardados en el dispositivo para cobro por WhatsApp
   */
  getDatosBancarios(): string {
    try {
      return localStorage.getItem(STORAGE_KEY_BANK) || '';
    } catch {
      return '';
    }
  }

  setDatosBancarios(datos: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_BANK, datos.trim());
    } catch {
      // fallback
    }
  }
}
