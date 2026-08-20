import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

let usuarioId = '';
let eventoId = '';
let participanteA = '';
let participanteB = '';
let participanteC = '';

async function crearUsuario(email: string): Promise<string> {
  const res = await request(app).post('/api/users').send({ nombre: 'Liquidador', email });
  return res.body.data.id;
}

async function crearEvento(creadorId: string, nombre: string): Promise<string> {
  const res = await request(app).post('/api/events').send({ nombre, creador_id: creadorId });
  return res.body.data.id;
}

beforeAll(async () => {
  usuarioId = await crearUsuario(`liquidador-${Date.now()}@example.com`);
  eventoId = await crearEvento(usuarioId, 'Mesa a liquidar');

  // Mesa de 3: 1 registrado + 2 fantasmas
  participanteA = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ usuario_id: usuarioId })
  ).body.data.id;
  participanteB = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Cierre 1' })
  ).body.data.id;
  participanteC = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Cierre 2' })
  ).body.data.id;

  // 2 consumos: 12000 entre 3 y 3000 solo para A
  // A: 4000+3000=7000, B:4000, C:4000, total 15000
  await request(app)
    .post(`/api/events/${eventoId}/consumptions`)
    .send({ monto_centavos: 12000, participante_ids: [participanteA, participanteB, participanteC] });
  await request(app)
    .post(`/api/events/${eventoId}/consumptions`)
    .send({ monto_centavos: 3000, participante_ids: [participanteA] });

  // Simulamos que A pagó 15000 (toda la cuenta) → A es acreedor 8000, B y C deudores 4000 c/u
  await prisma.participante.update({
    where: { id: participanteA },
    data: { monto_pagado_centavos: 15000 }
  });
});

describe('POST /api/events/:id/close', () => {
  it('liquida la mesa y genera el mínimo de transferencias', async () => {
    const res = await request(app).post(`/api/events/${eventoId}/close`);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evento.estado).toBe('CERRADO');
    expect(res.body.data.transacciones).toHaveLength(2);
    const suma = res.body.data.transacciones.reduce(
      (acc: number, t: { monto_centavos: number }) => acc + t.monto_centavos,
      0
    );
    expect(suma).toBe(8000);
  });

  it('bloquea participantes y consumos tras el cierre (409)', async () => {
    const r1 = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ nombre_invitado: 'Tarde' });
    expect(r1.status).toBe(409);

    const r2 = await request(app)
      .post(`/api/events/${eventoId}/consumptions`)
      .send({ monto_centavos: 100, participante_ids: [participanteA] });
    expect(r2.status).toBe(409);
  });

  it('rechaza cerrar dos veces (409)', async () => {
    const res = await request(app).post(`/api/events/${eventoId}/close`);
    expect(res.status).toBe(409);
  });

  it('GET /events/:id refleja el estado CERRADO y las transacciones', async () => {
    const res = await request(app).get(`/api/events/${eventoId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('CERRADO');
    expect(res.body.data.numero_transacciones).toBe(2);
  });

  it('404 para evento inexistente', async () => {
    const res = await request(app).post('/api/events/00000000-0000-0000-0000-000000000000/close');
    expect(res.status).toBe(404);
  });

  it('400 si la mesa tiene menos de 2 participantes', async () => {
    const eventoSolo = await crearEvento(usuarioId, 'Mesa vacía');
    await request(app).post(`/api/events/${eventoSolo}/participants`).send({ usuario_id: usuarioId });
    const res = await request(app).post(`/api/events/${eventoSolo}/close`);
    expect(res.status).toBe(400);
    // limpieza
    await prisma.participante.deleteMany({ where: { evento_id: eventoSolo } });
    await prisma.evento.deleteMany({ where: { id: eventoSolo } });
  });
});

afterAll(async () => {
  await prisma.transaccion.deleteMany({ where: { evento_id: eventoId } });
  await prisma.participante.deleteMany({ where: { evento_id: eventoId } });
  await prisma.evento.deleteMany({ where: { id: eventoId } });
  await prisma.usuario.deleteMany({ where: { id: usuarioId } });
});