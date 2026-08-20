import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

let usuarioId = '';
let eventoId = '';
let eventoCerradoId = '';
let participanteA = '';
let participanteB = '';
let participanteOtroEvento = '';
let eventoOtroId = '';

async function crearUsuario(email: string): Promise<string> {
  const res = await request(app).post('/api/users').send({ nombre: 'Pagador', email });
  return res.body.data.id;
}

beforeAll(async () => {
  usuarioId = await crearUsuario(`pagador-${Date.now()}@example.com`);
  eventoId = (await request(app).post('/api/events').send({ nombre: 'Mesa pagos', creador_id: usuarioId })).body.data.id;
  eventoCerradoId = (await request(app).post('/api/events').send({ nombre: 'Mesa cerrada pagos', creador_id: usuarioId }))
    .body.data.id;

  participanteA = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ usuario_id: usuarioId })
  ).body.data.id;
  participanteB = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Pago' })
  ).body.data.id;

  // Evento ajeno para probar "participante de otro evento"
  eventoOtroId = (await request(app).post('/api/events').send({ nombre: 'Otro', creador_id: usuarioId })).body.data.id;
  participanteOtroEvento = (
    await request(app).post(`/api/events/${eventoOtroId}/participants`).send({ nombre_invitado: 'Ajeno' })
  ).body.data.id;

  // Cerrar el eventoCerradoId
  const pCerrado = (
    await request(app).post(`/api/events/${eventoCerradoId}/participants`).send({ usuario_id: usuarioId })
  ).body.data.id;
  await request(app).post(`/api/events/${eventoCerradoId}/participants`).send({ nombre_invitado: 'Fantasma Cerrado' });
  await prisma.evento.update({ where: { id: eventoCerradoId }, data: { estado: 'CERRADO' } });
});

describe('POST /api/events/:id/payments', () => {
  it('registra un pago y acumula', async () => {
    const r1 = await request(app)
      .post(`/api/events/${eventoId}/payments`)
      .send({ participante_id: participanteA, monto_centavos: 5000 });
    expect(r1.status).toBe(201);
    expect(r1.body.success).toBe(true);
    expect(r1.body.data.monto_pagado_centavos).toBe(5000);

    const r2 = await request(app)
      .post(`/api/events/${eventoId}/payments`)
      .send({ participante_id: participanteA, monto_centavos: 3000 });
    expect(r2.status).toBe(201);
    expect(r2.body.data.monto_pagado_centavos).toBe(8000);
  });

  it('GET /events/:id refleja el monto pagado', async () => {
    const res = await request(app).get(`/api/events/${eventoId}`);
    const a = res.body.data.participantes.find((p: { id: string }) => p.id === participanteA);
    expect(a.monto_pagado_centavos).toBe(8000);
  });

  it('400 para monto 0, negativo o con decimales', async () => {
    for (const monto of [0, -100, 10.5]) {
      const res = await request(app)
        .post(`/api/events/${eventoId}/payments`)
        .send({ participante_id: participanteB, monto_centavos: monto });
      expect(res.status).toBe(400);
    }
  });

  it('400 para participante_id inválido o faltante', async () => {
    const r1 = await request(app)
      .post(`/api/events/${eventoId}/payments`)
      .send({ participante_id: 'no-es-uuid', monto_centavos: 100 });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post(`/api/events/${eventoId}/payments`)
      .send({ monto_centavos: 100 });
    expect(r2.status).toBe(400);
  });

  it('400 si el participante no pertenece al evento', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/payments`)
      .send({ participante_id: participanteOtroEvento, monto_centavos: 100 });
    expect(res.status).toBe(400);
  });

  it('404 para evento inexistente', async () => {
    const res = await request(app)
      .post('/api/events/00000000-0000-0000-0000-000000000000/payments')
      .send({ participante_id: participanteA, monto_centavos: 100 });
    expect(res.status).toBe(404);
  });

  it('409 para evento CERRADO', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoCerradoId}/payments`)
      .send({ participante_id: participanteA, monto_centavos: 100 });
    // participanteA no pertenece a eventoCerradoId, pero el bloqueo por CERRADO se chequea primero
    // así que probamos con un pago que toque el evento cerrado directamente
    expect([400, 409]).toContain(res.status);
    // Prueba limpia: participante real del evento cerrado
    const partCerrado = await prisma.participante.findFirst({ where: { evento_id: eventoCerradoId } });
    const r2 = await request(app)
      .post(`/api/events/${eventoCerradoId}/payments`)
      .send({ participante_id: partCerrado!.id, monto_centavos: 100 });
    expect(r2.status).toBe(409);
  });
});

afterAll(async () => {
  await prisma.participante.deleteMany({ where: { evento_id: { in: [eventoId, eventoOtroId, eventoCerradoId] } } });
  await prisma.evento.deleteMany({ where: { id: { in: [eventoId, eventoOtroId, eventoCerradoId] } } });
  await prisma.usuario.deleteMany({ where: { id: usuarioId } });
});