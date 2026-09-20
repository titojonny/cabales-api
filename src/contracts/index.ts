/**
 * DTOs del cliente Angular/Ionic legado en frontend/.
 * No describen el contrato modular /api/v1 documentado en docs/openapi.yaml.
 */

// --- ENUMS DE ESTADO ---

export type EstadoEvento = 'ACTIVO' | 'CERRADO';

export type EstadoTransaccion = 'PENDIENTE' | 'EN_REVISION' | 'EN_DISPUTA' | 'COMPLETADO';

// --- ENVELOPES ESTÁNDAR ---

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

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

// --- MODELOS Y DTOs: USUARIOS ---

export interface UsuarioDTO {
  id: string;
  nombre: string;
  email: string;
  avatar_url?: string | null;
  fecha_registro?: string | Date;
}

export interface CrearUsuarioDTO {
  nombre: string;
  email: string;
}

// --- MODELOS Y DTOs: EVENTOS ---

export interface EventoDTO {
  id: string;
  nombre: string;
  creador_id: string;
  fecha: string | Date;
  estado: EstadoEvento;
  total_gastado_centavos: number;
}

export interface CrearEventoDTO {
  nombre: string;
  creador_id: string;
}

export interface EventoUsuarioItemDTO {
  id: string;
  nombre: string;
  estado: EstadoEvento;
  fecha: string | Date;
  total_gastado_centavos: number;
  numero_comensales: number;
  es_creador: boolean;
  creador: {
    id: string;
    nombre: string;
  };
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
  fecha: string | Date;
  estado: EstadoEvento;
  total_gastado_centavos: number;
  numero_comensales: number;
  numero_transacciones: number;
  creador: {
    id: string;
    nombre: string;
    avatar_url: string | null;
  };
  participantes: ParticipanteDetalleDTO[];
}

// --- MODELOS Y DTOs: PARTICIPANTES ---

export interface ParticipanteDTO {
  id: string;
  evento_id: string;
  usuario_id: string | null;
  nombre_invitado: string | null;
  monto_consumido_centavos: number;
  monto_pagado_centavos: number;
}

export interface AgregarParticipanteDTO {
  usuario_id?: string;
  nombre_invitado?: string;
}

// --- MODELOS Y DTOs: CONSUMOS ---

export interface CrearConsumoDTO {
  descripcion?: string;
  monto_centavos: number;
  participante_ids: string[];
}

export interface ConsumoRegistradoDTO {
  descripcion: string | null;
  monto_centavos: number;
  repartido: number[];
}

// --- MODELOS Y DTOs: PAGOS ---

export interface RegistrarPagoDTO {
  participante_id: string;
  monto_centavos: number;
}

// --- MODELOS Y DTOs: TRANSACCIONES & LIQUIDACIÓN ---

export interface ParticipanteTransaccionDTO {
  id: string;
  nombre_visible: string;
  avatar_url?: string | null;
}

export interface TransaccionDTO {
  id: string;
  evento_id: string;
  monto_centavos: number;
  estado: EstadoTransaccion;
  comprobante_url: string | null;
  fecha_limite: string | Date | null;
  creado_en: string | Date;
  actualizado_en: string | Date;
  deudor: ParticipanteTransaccionDTO;
  acreedor: ParticipanteTransaccionDTO;
}

export interface ActualizarEstadoTransaccionDTO {
  estado: EstadoTransaccion;
  comprobante_url?: string;
}

export interface TransferenciaCalculadaDTO {
  deudorId: string;
  acreedorId: string;
  monto_centavos: number;
}

export interface CierreMesaDTO {
  evento: EventoDetalleDTO | null;
  transacciones: TransferenciaCalculadaDTO[];
}

// --- UTILIDADES FINANCIERAS PARA EL CLIENTE ---

/**
 * Convierte enteros de centavos a float en dólares (ej. 1050 centavos -> 10.50)
 */
export function centavosADolares(centavos: number): number {
  return centavos / 100;
}

/**
 * Convierte float de dólares a centavos enteros (ej. 10.50 -> 1050)
 */
export function dolaresACentavos(dolares: number): number {
  return Math.round(dolares * 100);
}

/**
 * Formatea centavos a moneda localizada (ej. 1050 -> "$10.50")
 */
export function formatearDinero(
  centavos: number,
  locale = 'es-SV',
  currency = 'USD'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(centavosADolares(centavos));
}
