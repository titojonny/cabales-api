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
  ActualizarEstadoTransaccionDTO,
  CerrarMesaBodyDTO,
  ConsumoDTO,
  ActualizarConsumoDTO,
  AgregarPropinaDTO,
  ConsumoRegistradoDTO
} from '../models/cabales.models';

@Injectable({
  providedIn: 'root'
})
export class CabalesApiService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // --- USUARIOS ---

  obtenerUsuarios(): Observable<UsuarioDTO[]> {
    return this.http
      .get<ApiResponse<UsuarioDTO[]>>(`${this.baseUrl}/users`)
      .pipe(map((res) => res.data));
  }

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
        creador_id: creadorId,
        auto_incluir_creador: true
      })
      .pipe(map((res) => res.data));
  }

  obtenerDetalleEvento(eventoId: string): Observable<EventoDetalleDTO> {
    return this.http
      .get<ApiResponse<EventoDetalleDTO>>(`${this.baseUrl}/events/${eventoId}`)
      .pipe(map((res) => res.data));
  }

  // --- PARTICIPANTES ---

  agregarParticipante(
    eventoId: string,
    data: AgregarParticipanteDTO
  ): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.baseUrl}/events/${eventoId}/participants`, data)
      .pipe(map((res) => res.data));
  }

  // --- CONSUMOS ---

  obtenerConsumos(eventoId: string): Observable<ConsumoDTO[]> {
    return this.http
      .get<ApiResponse<ConsumoDTO[]>>(`${this.baseUrl}/events/${eventoId}/consumptions`)
      .pipe(map((res) => res.data));
  }

  registrarConsumo(eventoId: string, data: CrearConsumoDTO): Observable<ConsumoRegistradoDTO> {
    return this.http
      .post<ApiResponse<ConsumoRegistradoDTO>>(`${this.baseUrl}/events/${eventoId}/consumptions`, data)
      .pipe(map((res) => res.data));
  }

  actualizarConsumo(
    eventoId: string,
    consumoId: string,
    data: ActualizarConsumoDTO
  ): Observable<ConsumoRegistradoDTO> {
    return this.http
      .put<ApiResponse<ConsumoRegistradoDTO>>(`${this.baseUrl}/events/${eventoId}/consumptions/${consumoId}`, data)
      .pipe(map((res) => res.data));
  }

  eliminarConsumo(eventoId: string, consumoId: string): Observable<any> {
    return this.http
      .delete<ApiResponse<any>>(`${this.baseUrl}/events/${eventoId}/consumptions/${consumoId}`)
      .pipe(map((res) => res.data));
  }

  agregarPropina(eventoId: string, data: AgregarPropinaDTO): Observable<ConsumoRegistradoDTO> {
    return this.http
      .post<ApiResponse<ConsumoRegistradoDTO>>(`${this.baseUrl}/events/${eventoId}/tip`, data)
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

  subirComprobante(transaccionId: string, archivo: File): Observable<TransaccionDTO> {
    const formData = new FormData();
    formData.append('comprobante', archivo);
    return this.http
      .post<ApiResponse<TransaccionDTO>>(`${this.baseUrl}/transactions/${transaccionId}/comprobante`, formData)
      .pipe(map((res) => res.data));
  }

  resolverUrlComprobante(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
    const host = this.baseUrl.replace(/\/api\/?$/, '');
    return `${host}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  // --- CIERRE DE MESA (GREEDY SETTLEMENT) ---

  cerrarEvento(eventoId: string, body: CerrarMesaBodyDTO = {}): Observable<CierreMesaDTO> {
    return this.http
      .post<ApiResponse<CierreMesaDTO>>(`${this.baseUrl}/events/${eventoId}/close`, body)
      .pipe(map((res) => res.data));
  }
}
