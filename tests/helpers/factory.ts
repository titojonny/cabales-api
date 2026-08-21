// Helpers de fábrica para tests de integración
// Elimina duplicación de crearUsuario/crearEvento en múltiples archivos de test

import request from 'supertest';
import { app } from '../src/app.js';

export interface UsuarioFixture {
  id: string;
  email: string;
  nombre: string;
}

export interface EventoFixture {
  id: string;
  nombre: string;
  creadorId: string;
}

export interface ParticipanteFixture {
  id: string;
  eventoId: string;
  usuarioId?: string;
  nombreInvitado?: string;
}

/**
 * Crea un usuario único y retorna su fixture
 */
export async function crearUsuario(email?: string): Promise<UsuarioFixture> {
  const e = email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app)
    .post('/api/users')
    .send({ nombre: 'Test User', email: e });
  if (res.status !== 201) throw new Error(`Error creando usuario: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id, email: e, nombre: 'Test User' };
}

/**
 * Crea un evento para un creador y retorna su fixture
 */
export async function crearEvento(creadorId: string, nombre?: string): Promise<EventoFixture> {
  const n = nombre ?? `Evento Test ${Date.now()}`;
  const res = await request(app)
    .post('/api/events')
    .send({ nombre: n, creador_id: creadorId });
  if (res.status !== 201) throw new Error(`Error creando evento: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id, nombre: n, creadorId };
}

/**
 * Agrega un participante (usuario registrado) a un evento
 */
export async function agregarParticipanteUsuario(eventoId: string, usuarioId: string) {
  const res = await request(app)
    .post(`/api/events/${eventoId}/participants`)
    .send({ usuario_id: usuarioId });
  if (res.status !== 201) throw new Error(`Error agregando participante: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/**
 * Agrega un invitado fantasma a un evento
 */
export async function agregarParticipanteFantasma(eventoId: string, nombre: string) {
  const res = await request(app)
    .post(`/api/events/${eventoId}/participants`)
    .send({ nombre_invitado: nombre });
  if (res.status !== 201) throw new Error(`Error agregando fantasma: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/**
 * Registra un consumo compartido
 */
export async function registrarConsumo(
  eventoId: string,
  participanteIds: string[],
  montoCentavos: number,
  descripcion?: string
) {
  const res = await request(app)
    .post(`/api/events/${eventoId}/consumptions`)
    .send({ descripcion, monto_centavos: montoCentavos, participante_ids: participanteIds });
  if (res.status !== 201) throw new Error(`Error registrando consumo: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/**
 * Registra un pago de un participante
 */
export async function registrarPago(eventoId: string, participanteId: string, montoCentavos: number) {
  const res = await request(app)
    .post(`/api/events/${eventoId}/payments`)
    .send({ participante_id: participanteId, monto_centavos: montoCentavos });
  if (res.status !== 201) throw new Error(`Error registrando pago: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/**
 * Cierra un evento
 */
export async function cerrarEvento(eventoId: string) {
  const res = await request(app)
    .post(`/api/events/${eventoId}/close`);
  if (res.status !== 201) throw new Error(`Error cerrando evento: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/**
 * Limpieza completa: transacciones -> participantes -> eventos -> usuarios
 */
export async function limpiarTodo(
  prisma: any,
  eventosIds: string[],
  usuariosIds: string[]
): Promise<void> {
  await prisma.transaccion.deleteMany({ where: { evento_id: { in: eventosIds } } });
  await prisma.participante.deleteMany({ where: { evento_id: { in: [] } } }); // se filtra abajo
  await prisma.participante.deleteMany({ where: { evento_id: { in: eventosIds } } });
  await prisma.evento.deleteMany({ where: { id: { in: eventosIds } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuariosIds } } });
}