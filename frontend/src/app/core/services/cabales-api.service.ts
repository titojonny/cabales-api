import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiResponse,
  UsuarioDTO,
  EventoDTO,
  EventoUsuarioItemDTO,
  EventoDetalleDTO,
  TransaccionDTO,
  CierreMesaDTO,
  EstadoTransaccion,
  CrearConsumoDTO,
  RegistrarPagoDTO,
  AgregarParticipanteDTO,
  ActualizarEstadoTransaccionDTO
} from '../models/cabales.models';

@Injectable({
  providedIn: 'root'
})
export class CabalesApiService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // --- USUARIOS ---

  crearUsuario(nombre: string, email: string): Observable<UsuarioDTO> {
    return this.http
      .post<ApiResponse<UsuarioDTO>>(`${this.baseUrl}/users`, { nombre, email })
      .pipe(map((res) => res.data));
  }

  obtenerEventosUsuario(usuarioId: string): Observable<EventoUsuarioItemDTO[]> {
    return this.http
      .get<ApiResponse<EventoUsuarioItemDTO[]>>(`${this.baseUrl}/users/${usuarioId}/events`)
      .pipe(map((res) => res.data));
  }

  // --- EVENTOS ---

  crearEvento(nombre: string, creadorId: string): Observable<EventoDTO> {
    return this.http
      .post<ApiResponse<EventoDTO>>(`${this.baseUrl}/events`, {
        nombre,
        creador_id: creadorId
      })
      .pipe(map((res) => res.data));
  }

  obtenerDetalleEvento(eventoId: string): Observable<EventoDetalleDTO> {
    return this.http
      .get<ApiResponse<EventoDetalleDTO>>(`${this.baseUrl}/events/${eventoId}`)
      .pipe(map((res) => res.data));
  }

  // --- PARTICIPANTES ---

  agregarParticipante(eventoId: string, data: AgregarParticipanteDTO): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.baseUrl}/events/${eventoId}/participants`, data)
      .pipe(map((res) => res.data));
  }

  // --- CONSUMOS ---

  registrarConsumo(eventoId: string, data: CrearConsumoDTO): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.baseUrl}/events/${eventoId}/consumptions`, data)
      .pipe(map((res) => res.data));
  }

  // --- PAGOS ---

  registrarPago(eventoId: string, data: RegistrarPagoDTO): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.baseUrl}/events/${eventoId}/payments`, data)
      .pipe(map((res) => res.data));
  }

  // --- TRANSACCIONES ---

  obtenerTransacciones(eventoId: string): Observable<TransaccionDTO[]> {
    return this.http
      .get<ApiResponse<TransaccionDTO[]>>(`${this.baseUrl}/events/${eventoId}/transactions`)
      .pipe(map((res) => res.data));
  }

  actualizarEstadoTransaccion(
    transaccionId: string,
    data: ActualizarEstadoTransaccionDTO
  ): Observable<TransaccionDTO> {
    return this.http
      .patch<ApiResponse<TransaccionDTO>>(`${this.baseUrl}/transactions/${transaccionId}/status`, data)
      .pipe(map((res) => res.data));
  }

  // --- CIERRE DE MESA (GREEDY SETTLEMENT) ---

  cerrarEvento(eventoId: string): Observable<CierreMesaDTO> {
    return this.http
      .post<ApiResponse<CierreMesaDTO>>(`${this.baseUrl}/events/${eventoId}/close`, {})
      .pipe(map((res) => res.data));
  }
}
