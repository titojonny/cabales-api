import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const stamp = Date.now();
let usuarioA = '';
let usuarioB = '';
let usuarioC = '';
let eventoUno = '';
let eventoDos = '';
let participanteA = '';
let participanteFantasma = '';

async function crearUsuario(nombre: string): Promise<string> {
  const res = await request(app)
    .post('/api/users')
    .send({ nombre, email: `${nombre.toLowerCase()}-${stamp}@example.com` });
  return res.body.data.id;
}

beforeAll(async () => {
  usuarioA = await crearUsuario('Ana');
  usuarioB = await crearUsuario('Beto');
  usuarioC = await crearUsuario('Carla');

  // Evento 1: Ana crea y se sienta junto a un fantasma
  eventoUno = (
    await request(app).post('/api/events').send({ nombre: 'Cena uno', creador_id: usuarioA })
  ).body.data.id;
  participanteA = (
    await request(app).post(`/api/events/${eventoUno}/participants`).send({ usuario_id: usuarioA })
  ).body.data.id;
  participanteFantasma = (
    await request(app).post(`/api/events/${eventoUno}/participants`).send({ nombre_invitado: 'Fantasma Uno' })
  ).body.data.id;

  // Evento 2: Beto crea e invita a Ana (Ana es creadora de uno y invitada en otro)
  eventoDos = (
    await request(app).post('/api/events').send({ nombre: 'Cena dos', creador_id: usuarioB })
  ).body.data.id;
  await request(app).post(`/api/events/${eventoDos}/participants`).send({ usuario_id: usuarioA });

  // Fechas fijas para que el orden por fecha sea determinista
  await prisma.evento.update({ where: { id: eventoUno }, data: { fecha: new Date('2026-01-01T00:00:00.000Z') } });
  await prisma.evento.update({ where: { id: eventoDos }, data: { fecha: new Date('2026-02-01T00:00:00.000Z') } });

  // Consumos para probar el orden por monto_consumido_centavos DESC
  await request(app)
    .post(`/api/events/${eventoUno}/consumptions`)
    .send({ descripcion: 'Parrillada', monto_centavos: 7000, participante_ids: [participanteFantasma] });
  await request(app)
    .post(`/api/events/${eventoUno}/consumptions`)
    .send({ descripcion: 'Postre', monto_centavos: 3000, participante_ids: [participanteA] });
});

describe('GET /api/users/:id/events', () => {
  it('devuelve el dashboard con eventos como creador y como invitado', async () => {
    const res = await request(app).get(`/api/users/${usuarioA}/events`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Dos eventos, sin duplicados aunque Ana sea creadora Y participante del evento uno
    expect(res.body.data).toHaveLength(2);
    // Orden por fecha DESC: la cena más reciente primero
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([eventoDos, eventoUno]);

    const comoCreador = res.body.data.find((e: { id: string }) => e.id === eventoUno);
    const comoInvitado = res.body.data.find((e: { id: string }) => e.id === eventoDos);
    expect(comoCreador.es_creador).toBe(true);
    expect(comoCreador.creador.id).toBe(usuarioA);
    expect(comoCreador.total_gastado_centavos).toBe(10000);
    expect(comoInvitado.es_creador).toBe(false);
    expect(comoInvitado.creador.id).toBe(usuarioB);
  });

  it('calcula numero_comensales correctamente', async () => {
    const res = await request(app).get(`/api/users/${usuarioA}/events`);
    const comoCreador = res.body.data.find((e: { id: string }) => e.id === eventoUno);
    const comoInvitado = res.body.data.find((e: { id: string }) => e.id === eventoDos);
    expect(comoCreador.numero_comensales).toBe(2); // Ana + fantasma
    expect(comoInvitado.numero_comensales).toBe(1); // Solo Ana invitada
  });

  it('los fantasmas no filtran eventos al dashboard de otros usuarios', async () => {
    // Carla nunca fue invitada: lista vacía aunque haya fantasmas en la mesa
    const res = await request(app).get(`/api/users/${usuarioC}/events`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('un usuario inexistente da 404', async () => {
    const res = await request(app).get('/api/users/00000000-0000-0000-0000-000000000000/events');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/events/:id', () => {
  it('devuelve la radiografía de la mesa ordenada por consumo', async () => {
    const res = await request(app).get(`/api/events/${eventoUno}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(res.body.data.creador.id).toBe(usuarioA);
    expect(res.body.data.creador.nombre).toBe('Ana');
    expect(res.body.data.total_gastado_centavos).toBe(10000);
    expect(res.body.data.numero_comensales).toBe(2);
    expect(res.body.data.numero_transacciones).toBe(0);

    const [primero, segundo] = res.body.data.participantes;
    // El fantasma consumió más (7000 vs 3000) y va primero
    expect(primero.nombre_visible).toBe('Fantasma Uno');
    expect(primero.es_fantasma).toBe(true);
    expect(primero.usuario_id).toBeNull();
    expect(primero.monto_consumido_centavos).toBe(7000);
    expect(segundo.nombre_visible).toBe('Ana');
    expect(segundo.es_fantasma).toBe(false);
    expect(segundo.usuario_id).toBe(usuarioA);
    expect(segundo.monto_consumido_centavos).toBe(3000);
  });

  it('un evento inexistente da 404', async () => {
    const res = await request(app).get('/api/events/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

afterAll(async () => {
  await prisma.participante.deleteMany({ where: { evento_id: { in: [eventoUno, eventoDos] } } });
  await prisma.evento.deleteMany({ where: { id: { in: [eventoUno, eventoDos] } } });
  await prisma.usuario.deleteMany({ where: { id: { in: [usuarioA, usuarioB, usuarioC] } } });
});
