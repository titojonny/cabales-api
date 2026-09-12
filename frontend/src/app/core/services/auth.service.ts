import { Injectable, signal, computed } from '@angular/core';
import { UsuarioDTO } from '../models/cabales.models';

const STORAGE_KEY_USER = 'cabales_active_user';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Usuario activo reactivo con Angular Signals
  private currentUserSignal = signal<UsuarioDTO | null>(this.loadStoredUser());

  readonly currentUser = computed(() => this.currentUserSignal());
  readonly currentUserId = computed(() => this.currentUserSignal()?.id || '');
  readonly isLoggedIn = computed(() => !!this.currentUserSignal());

  private loadStoredUser(): UsuarioDTO | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_USER);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Ignorar errores de localStorage
    }
    // Usuario por defecto si no hay nada guardado
    return {
      id: 'default-user-id',
      nombre: 'Jonathan',
      email: 'jonathan@ufg.edu.sv'
    };
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
    localStorage.removeItem(STORAGE_KEY_USER);
  }
}
