# Guía de Integración Frontend: Angular / Ionic para Cabales API

Esta guía proporciona la arquitectura recomendada y el código base para conectar una aplicación **Angular 17+ / Ionic 7+ (Capacitor)** con **Cabales API**.

---

## 1. Configuración de Entorno en Angular

En tu proyecto Angular/Ionic, define la URL base en `src/environments/environment.ts`:

```typescript
// src/environments/environment.ts (Desarrollo Web / Emulador)
export const environment = {
  production: false,
  // En navegador web local:
  apiUrl: 'http://localhost:3000/api'
  // Si pruebas en dispositivo físico en la misma red Wi-Fi:
  // apiUrl: 'http://192.168.1.50:3000/api'
};
```

```typescript
// src/environments/environment.prod.ts (Producción / Mobile Build)
export const environment = {
  production: true,
  apiUrl: 'https://api.tudominio.com/api'
};
```

---

## 2. Modelos y Contratos de Tipos (TypeScript)

El backend expone todos los tipos en `src/contracts/index.ts`. Puedes copiarlos o referenciarlos en tu frontend:

```typescript
// src/app/core/models/cabales.models.ts

export type EstadoEvento = 'ACTIVO' | 'CERRADO';
export type EstadoTransaccion = 'PENDIENTE' | 'EN_REVISION' | 'EN_DISPUTA' | 'COMPLETADO';

export interface ApiResponse<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error?: string | string[];
}

export interface UsuarioDTO {
  id: string;
  nombre: string;
  email: string;
  avatar_url?: string | null;
}

export interface EventoUsuarioItemDTO {
  id: string;
  nombre: string;
  estado: EstadoEvento;
  fecha: string;
  total_gastado_centavos: number;
  numero_comensales: number;
  es_creador: boolean;
  creador: { id: string; nombre: string };
}

export interface ParticipanteDetalleDTO {
  id: string;
  nombre_visible: string;
  es_fantasma: boolean;
  usuario_id: string | null;
  monto_consumido_centavos: number;
  monto_pagado_centavos: number;
}

export interface EventoDetalleDTO {
  id: string;
  nombre: string;
  fecha: string;
  estado: EstadoEvento;
  total_gastado_centavos: number;
  numero_comensales: number;
  numero_transacciones: number;
  creador: { id: string; nombre: string; avatar_url: string | null };
  participantes: ParticipanteDetalleDTO[];
}

export interface TransaccionDTO {
  id: string;
  evento_id: string;
  monto_centavos: number;
  estado: EstadoTransaccion;
  comprobante_url: string | null;
  fecha_limite: string | null;
  creado_en: string;
  actualizado_en: string;
  deudor: { id: string; nombre_visible: string; avatar_url?: string | null };
  acreedor: { id: string; nombre_visible: string; avatar_url?: string | null };
}

export interface CierreMesaDTO {
  evento: EventoDetalleDTO;
  transacciones: Array<{ deudorId: string; acreedorId: string; monto_centavos: number }>;
}
```

---

## 3. Pipe de Dinero para Angular / Ionic (Centavos a Dólares)

Para respetar la **Regla de Oro** (dinero en centavos `Int`), la UI formatea al vuelo:

```typescript
// src/app/shared/pipes/centavos-a-dinero.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'centavosADinero',
  standalone: true
})
export class CentavosADineroPipe implements PipeTransform {
  transform(centavos: number | null | undefined, locale = 'es-SV', currency = 'USD'): string {
    if (centavos === null || centavos === undefined) return '$0.00';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency
    }).format(centavos / 100);
  }
}
```

**Uso en templates HTML de Ionic / Angular:**
```html
<ion-card>
  <ion-card-header>
    <ion-card-title>{{ evento.nombre }}</ion-card-title>
    <ion-badge [color]="evento.estado === 'ACTIVO' ? 'success' : 'medium'">
      {{ evento.estado }}
    </ion-badge>
  </ion-card-header>
  <ion-card-content>
    <p>Total mesa: {{ evento.total_gastado_centavos | centavosADinero }}</p>
  </ion-card-content>
</ion-card>
```

---

## 4. Servicio Angular (`CabalesApiService`)

Implementación con `HttpClient` tipado y desempaquetado automático de `data`:

```typescript
// src/app/core/services/cabales-api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiResponse,
  UsuarioDTO,
  EventoUsuarioItemDTO,
  EventoDetalleDTO,
  TransaccionDTO,
  CierreMesaDTO,
  EstadoTransaccion
} from '../models/cabales.models';

@Injectable({
  providedIn: 'root'
})
export class CabalesApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  // --- USUARIOS ---
  crearUsuario(nombre: string, email: string): Observable<UsuarioDTO> {
    return this.http
      .post<ApiResponse<UsuarioDTO>>(`${this.base}/users`, { nombre, email })
      .pipe(map((res) => res.data));
  }

  obtenerEventosUsuario(usuarioId: string): Observable<EventoUsuarioItemDTO[]> {
    return this.http
      .get<ApiResponse<EventoUsuarioItemDTO[]>>(`${this.base}/users/${usuarioId}/events`)
      .pipe(map((res) => res.data));
  }

  // --- EVENTOS ---
  crearEvento(nombre: string, creadorId: string): Observable<{ id: string; nombre: string }> {
    return this.http
      .post<ApiResponse<{ id: string; nombre: string }>>(`${this.base}/events`, {
        nombre,
        creador_id: creadorId
      })
      .pipe(map((res) => res.data));
  }

  obtenerDetalleEvento(eventoId: string): Observable<EventoDetalleDTO> {
    return this.http
      .get<ApiResponse<EventoDetalleDTO>>(`${this.base}/events/${eventoId}`)
      .pipe(map((res) => res.data));
  }

  // --- PARTICIPANTES ---
  agregarParticipanteRegistrado(eventoId: string, usuarioId: string) {
    return this.http
      .post<ApiResponse<any>>(`${this.base}/events/${eventoId}/participants`, { usuario_id: usuarioId })
      .pipe(map((res) => res.data));
  }

  agregarInvitadoFantasma(eventoId: string, nombreInvitado: string) {
    return this.http
      .post<ApiResponse<any>>(`${this.base}/events/${eventoId}/participants`, {
        nombre_invitado: nombreInvitado
      })
      .pipe(map((res) => res.data));
  }

  // --- CONSUMOS ---
  registrarConsumo(eventoId: string, montoCentavos: number, participanteIds: string[], descripcion?: string) {
    return this.http
      .post<ApiResponse<any>>(`${this.base}/events/${eventoId}/consumptions`, {
        descripcion,
        monto_centavos: montoCentavos,
        participante_ids: participanteIds
      })
      .pipe(map((res) => res.data));
  }

  // --- PAGOS ---
  registrarPago(eventoId: string, participanteId: string, montoCentavos: number) {
    return this.http
      .post<ApiResponse<any>>(`${this.base}/events/${eventoId}/payments`, {
        participante_id: participanteId,
        monto_centavos: montoCentavos
      })
      .pipe(map((res) => res.data));
  }

  // --- CIERRE & LIQUIDACIÓN GREEDY ---
  cerrarMesa(eventoId: string): Observable<CierreMesaDTO> {
    return this.http
      .post<ApiResponse<CierreMesaDTO>>(`${this.base}/events/${eventoId}/close`, {})
      .pipe(map((res) => res.data));
  }

  // --- TRANSACCIONES ---
  obtenerTransacciones(eventoId: string): Observable<TransaccionDTO[]> {
    return this.http
      .get<ApiResponse<TransaccionDTO[]>>(`${this.base}/events/${eventoId}/transactions`)
      .pipe(map((res) => res.data));
  }

  actualizarEstadoTransaccion(
    transaccionId: string,
    estado: EstadoTransaccion,
    comprobanteUrl?: string
  ): Observable<TransaccionDTO> {
    return this.http
      .patch<ApiResponse<TransaccionDTO>>(`${this.base}/transactions/${transaccionId}/status`, {
        estado,
        comprobante_url: comprobanteUrl
      })
      .pipe(map((res) => res.data));
  }
}
```

---

## 5. Interceptor de Errores con Ionic Toast

Muestra amigablemente los mensajes de error formateados por el backend:

```typescript
// src/app/core/interceptors/error.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { catchError, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastCtrl = inject(ToastController);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let mensaje = 'Ocurrió un error inesperado';

      if (error.error?.message) {
        mensaje = error.error.message;
      } else if (error.status === 0) {
        mensaje = 'No se pudo conectar al servidor. Revisa tu conexión a internet.';
      }

      toastCtrl
        .create({
          message: mensaje,
          duration: 3500,
          color: 'danger',
          position: 'top'
        })
        .then((toast) => toast.present());

      return throwError(() => error);
    })
  );
};
```
