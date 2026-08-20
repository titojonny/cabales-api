import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

let usuarioId = '';
let eventoId = '';
let eventoCerradoId = '';
let participanteA = '';
let participanteB = '';
let participanteC = '';

async function crearUsuario(email?: string): Promise<string> {
  const res = await request(app)
    .post('/api/users')
    .send({ nombre: 'Comensal', email: email ?? `comensal-${Date.now()}@example.com` });
  return res.body.data.id;
}

async function crearEvento(creadorId: string): Promise<string> {
  const res = await request(app)
    .post('/api/events')
    .send({ nombre: 'Cena de pruebas', creador_id: creadorId });
  return res.body.data.id;
}

beforeAll(async () => {
  usuarioId = await crearUsuario();
  eventoId = await crearEvento(usuarioId);
  eventoCerradoId = await crearEvento(usuarioId);
  await prisma.evento.update({ where: { id: eventoCerradoId }, data: { estado: 'CERRADO' } });

  // Fixture de la mesa: 1 usuario registrado + 2 fantasmas, vía API
  participanteA = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ usuario_id: usuarioId })
  ).body.data.id;
  participanteB = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Uno' })
  ).body.data.id;
  participanteC = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Dos' })
  ).body.data.id;
});

describe('POST /api/events/:id/participants', () => {
  it('agrega un usuario registrado a la mesa', async () => {
    const usuarioNuevo = await crearUsuario(`nuevo-${Date.now()}@example.com`);
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ usuario_id: usuarioNuevo });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Usuario agregado a la mesa');
    expect(res.body.data.usuario_id).toBe(usuarioNuevo);
    expect(res.body.data.monto_consumido_centavos).toBe(0);
    await prisma.usuario.deleteMany({ where: { id: usuarioNuevo } });
  });

  it('rechaza al mismo usuario dos veces (409)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ usuario_id: usuarioId });
    expect(res.status).toBe(409);
  });

  it('agrega un invitado fantasma', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ nombre_invitado: 'Fantasma API' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Invitado fantasma agregado');
    expect(res.body.data.nombre_invitado).toBe('Fantasma API');
  });

  it('rechaza enviar usuario Y fantasma a la vez (400)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ usuario_id: usuarioId, nombre_invitado: 'Ambos' });
    expect(res.status).toBe(400);
  });

  it('rechaza enviar ninguno de los dos (400)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rechaza un UUID inválido (400)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/participants`)
      .send({ usuario_id: 'no-es-uuid' });
    expect(res.status).toBe(400);
  });

  it('rechaza un evento inexistente (404)', async () => {
    const res = await request(app)
      .post('/api/events/00000000-0000-0000-0000-000000000000/participants')
      .send({ nombre_invitado: 'Solo' });
    expect(res.status).toBe(404);
  });

  it('rechaza agregar a un evento CERRADO (409)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoCerradoId}/participants`)
      .send({ nombre_invitado: 'Tarde' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/events/:id/consumptions', () => {
  it('registra un consumo compartido y reparte los centavos exactos', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/consumptions`)
      .send({ descripcion: 'Pizza', monto_centavos: 10000, participante_ids: [participanteA, participanteB, participanteC] });
    expect(res.status).toBe(201);
    expect(res.body.data.repartido).toEqual([3334, 3333, 3333]);

    const total = await prisma.evento.findUnique({ where: { id: eventoId }, select: { total_gastado_centavos: true } });
    expect(total?.total_gastado_centavos).toBe(10000);

    const consumos = await prisma.participante.findMany({
      where: { id: { in: [participanteA, participanteB, participanteC] } },
      select: { monto_consumido_centavos: true }
    });
    const suma = consumos.reduce((acc, p) => acc + p.monto_consumido_centavos, 0);
    expect(suma).toBe(10000);
  });

  it('registra un consumo individual sin tocar a los demás', async () => {
    await request(app)
      .post(`/api/events/${eventoId}/consumptions`)
      .send({ monto_centavos: 5000, participante_ids: [participanteA] });

    const [a, b] = await prisma.$transaction([
      prisma.participante.findUniqueOrThrow({ where: { id: participanteA }, select: { monto_consumido_centavos: true } }),
      prisma.participante.findUniqueOrThrow({ where: { id: participanteB }, select: { monto_consumido_centavos: true } })
    ]);
    expect(a.monto_consumido_centavos).toBe(8334);
    expect(b.monto_consumido_centavos).toBe(3333);
  });

  it('rechaza participantes duplicados en el mismo consumo (400)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/consumptions`)
      .send({ monto_centavos: 100, participante_ids: [participanteA, participanteA] });
    expect(res.status).toBe(400);
  });

  it('rechaza un participante de otro evento (400)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoId}/consumptions`)
      .send({ monto_centavos: 100, participante_ids: [usuarioId] });
    expect(res.status).toBe(400);
  });

  it('rechaza un evento inexistente (404)', async () => {
    const res = await request(app)
      .post('/api/events/00000000-0000-0000-0000-000000000000/consumptions')
      .send({ monto_centavos: 100, participante_ids: [participanteA] });
    expect(res.status).toBe(404);
  });

  it('rechaza un evento CERRADO (409)', async () => {
    const res = await request(app)
      .post(`/api/events/${eventoCerradoId}/consumptions`)
      .send({ monto_centavos: 100, participante_ids: [participanteA] });
    expect(res.status).toBe(409);
  });

  it('rechaza monto en cero, negativo o con decimales (400)', async () => {
    for (const monto of [0, -100, 100.5]) {
      const res = await request(app)
        .post(`/api/events/${eventoId}/consumptions`)
        .send({ monto_centavos: monto, participante_ids: [participanteA] });
      expect(res.status).toBe(400);
    }
  });
});

afterAll(async () => {
  await prisma.participante.deleteMany({ where: { evento_id: { in: [eventoId, eventoCerradoId] } } });
  await prisma.evento.deleteMany({ where: { id: { in: [eventoId, eventoCerradoId] } } });
  await prisma.usuario.deleteMany({ where: { id: usuarioId } });
});