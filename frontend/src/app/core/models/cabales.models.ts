/**
 * Modelos de Dominio y Contratos de Cabales API para el cliente frontend.
 */

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
  fecha_registro?: string | Date;
}

export interface CrearUsuarioDTO {
  nombre: string;
  email: string;
}

export interface EventoUsuarioItemDTO {
  id: string;
  nombre: string;
  estado: EstadoEvento;
  fecha: string;
  total_gastado_centavos: number;
  numero_comensales: number;
  es_creador: boolean;
  creador: {
    id: string;
    nombre: string;
  };
  esta_saldado?: boolean;
  total_transacciones?: number;
  transacciones_completadas?: number;
  transacciones_pendientes?: number;
}

export interface EventoDTO {
  id: string;
  nombre: string;
  creador_id: string;
  fecha: string | Date;
  estado: EstadoEvento;
}

export interface ParticipanteDetalleDTO {
  id: string;
  nombre_visible: string;
  es_fantasma: boolean;
  usuario_id: string | null;
  monto_consumido_centavos: number;
  monto_pagado_centavos: number;
  deuda_pendiente_centavos?: number;
  por_cobrar_pendiente_centavos?: number;
  deuda_saldada_centavos?: number;
  esta_saldado?: boolean;
}

export interface EventoDetalleDTO {
  id: string;
  nombre: string;
  fecha: string;
  estado: EstadoEvento;
  total_gastado_centavos: number;
  numero_comensales: number;
  numero_transacciones: number;
  total_transacciones?: number;
  transacciones_completadas?: number;
  transacciones_pendientes?: number;
  esta_totalmente_saldado?: boolean;
  creador: {
    id: string;
    nombre: string;
    avatar_url: string | null;
  };
  participantes: ParticipanteDetalleDTO[];
}

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

export interface CrearConsumoDTO {
  descripcion?: string;
  monto_centavos: number;
  participante_ids: string[];
}

export interface ActualizarConsumoDTO {
  descripcion?: string;
  monto_centavos: number;
  participante_ids: string[];
}

export interface AgregarPropinaDTO {
  porcentaje?: number;
  participante_ids?: string[];
}

export interface ConsumoParticipanteDTO {
  id: string;
  participante_id: string;
  monto_centavos: number;
  nombre_visible: string;
  es_fantasma: boolean;
}

export interface ConsumoDTO {
  id: string;
  evento_id: string;
  descripcion: string | null;
  monto_centavos: number;
  creado_en: string;
  participantes: ConsumoParticipanteDTO[];
}

export interface ConsumoRegistradoDTO {
  id?: string;
  descripcion: string | null;
  monto_centavos: number;
  repartido: number[];
  porcentaje?: number;
}

export interface RegistrarPagoDTO {
  participante_id: string;
  monto_centavos: number;
}

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
  fecha_limite: string | null;
  creado_en: string;
  actualizado_en: string;
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

export interface CerrarMesaBodyDTO {
  pagador_restante_id?: string;
}

export interface CierreMesaDTO {
  evento: EventoDetalleDTO | null;
  transacciones: TransferenciaCalculadaDTO[];
}
