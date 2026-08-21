import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

let usuarioId = '';
let eventoId = '';
let eventoVacioId = '';
let transaccionPendienteId = '';
let transaccionSegundaId = '';

async function crearUsuario(email: string): Promise<string> {
  const res = await request(app).post('/api/users').send({ nombre: 'Transaccionero', email });
  return res.body.data.id;
}

async function crearTransaccionAislada(creadorId: string): Promise<string> {
  const eventoId = (await request(app).post('/api/events').send({ nombre: 'Tx Aislada', creador_id: creadorId })).body.data.id;
  const pa = (await request(app).post(`/api/events/${eventoId}/participants`).send({ usuario_id: creadorId })).body.data.id;
  const pb = (await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'F Aislado' })).body.data.id;
  await request(app).post(`/api/events/${eventoId}/consumptions`).send({ monto_centavos: 10000, participante_ids: [pa, pb] });
  await request(app).post(`/api/events/${eventoId}/payments`).send({ participante_id: pa, monto_centavos: 10000 });
  await request(app).post(`/api/events/${eventoId}/close`);
  const tx = await prisma.transaccion.findFirst({ where: { evento_id: eventoId }, orderBy: { creado_en: 'asc' } });
  return tx!.id;
}

beforeAll(async () => {
  usuarioId = await crearUsuario(`tx-${Date.now()}@example.com`);
  eventoId = (await request(app).post('/api/events').send({ nombre: 'Mesa Tx', creador_id: usuarioId })).body.data.id;
  eventoVacioId = (await request(app).post('/api/events').send({ nombre: 'Mesa Vacía Tx', creador_id: usuarioId }))
    .body.data.id;

  const pa = (await request(app).post(`/api/events/${eventoId}/participants`).send({ usuario_id: usuarioId })).body
    .data.id;
  const pb = (
    await request(app).post(`/api/events/${eventoId}/participants`).send({ nombre_invitado: 'Fantasma Tx' })
  ).body.data.id;

  // Dos consumos para generar deuda
  await request(app)
    .post(`/api/events/${eventoId}/consumptions`)
    .send({ monto_centavos: 10000, participante_ids: [pa, pb] });
  // pa paga todo
  await request(app).post(`/api/events/${eventoId}/payments`).send({ participante_id: pa, monto_centavos: 10000 });

  // Cerrar -> genera 1 transacción PENDIENTE (pb debe 5000 a pa)
  const close = await request(app).post(`/api/events/${eventoId}/close`);
  const txs: Array<{ id: string }> = close.body.data.transacciones.length
    ? (
        await prisma.transaccion.findMany({ where: { evento_id: eventoId }, select: { id: true } })
      )
    : [];
  // fallback si close no devuelve ids (usa DB)
  const dbTxs = await prisma.transaccion.findMany({ where: { evento_id: eventoId }, orderBy: { creado_en: 'asc' } });
  transaccionPendienteId = dbTxs[0]!.id;
  // Crear segunda transacción manualmente para probar la máquina en otro estado
  // (otro evento con 3 participantes para tener 2 txs)
  const pa2 = pa;
  const pc = (
    await request(app).post(`/api/events/${eventoVacioId}/participants`).send({ usuario_id: usuarioId })
  ).body.data.id;
  const pd = (
    await request(app).post(`/api/events/${eventoVacioId}/participants`).send({ nombre_invitado: 'Fantasma Tx 2' })
  ).body.data.id;
  await request(app)
    .post(`/api/events/${eventoVacioId}/consumptions`)
    .send({ monto_centavos: 9000, participante_ids: [pc, pd] });
  await request(app).post(`/api/events/${eventoVacioId}/payments`).send({ participante_id: pc, monto_centavos: 9000 });
  await request(app).post(`/api/events/${eventoVacioId}/close`);
  const tx2 = await prisma.transaccion.findFirst({ where: { evento_id: eventoVacioId } });
  transaccionSegundaId = tx2!.id;
});

describe('GET /api/events/:id/transactions', () => {
  it('lista transacciones con deudor/acreedor enriquecido', async () => {
    const res = await request(app).get(`/api/events/${eventoId}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].monto_centavos).toBe(5000);
    expect(res.body.data[0].deudor.nombre_visible).toBeDefined();
    expect(res.body.data[0].acreedor.nombre_visible).toBeDefined();
  });

  it('evento vacío sin transacciones → []', async () => {
    const eventoSolo = (await request(app).post('/api/events').send({ nombre: 'Solo', creador_id: usuarioId })).body
      .data.id;
    const res = await request(app).get(`/api/events/${eventoSolo}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    await prisma.evento.deleteMany({ where: { id: eventoSolo } });
  });

  it('404 para evento inexistente', async () => {
    const res = await request(app).get('/api/events/00000000-0000-0000-0000-000000000000/transactions');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/transactions/:id/status', () => {
  it('PENDIENTE -> EN_REVISION exige comprobante (400 sin él)', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionPendienteId}/status`)
      .send({ estado: 'EN_REVISION' });
    expect(res.status).toBe(400);
  });

  it('PENDIENTE -> EN_REVISION con comprobante (200)', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionPendienteId}/status`)
      .send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/comprobante.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('EN_REVISION');
    expect(res.body.data.comprobante_url).toBe('https://example.com/comprobante.jpg');
  });

  it('EN_REVISION -> COMPLETADO (200)', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionPendienteId}/status`)
      .send({ estado: 'COMPLETADO' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('COMPLETADO');
  });

  it('COMPLETADO es terminal (409)', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionPendienteId}/status`)
      .send({ estado: 'PENDIENTE' });
    expect(res.status).toBe(409);
  });

  it('PENDIENTE -> COMPLETADO directo permitido (efectivo)', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionSegundaId}/status`)
      .send({ estado: 'COMPLETADO' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('COMPLETADO');
  });

  it('transacción inexistente → 404', async () => {
    const res = await request(app)
      .patch('/api/transactions/00000000-0000-0000-0000-000000000000/status')
      .send({ estado: 'COMPLETADO' });
    expect(res.status).toBe(404);
  });

  it('estado fuera de enum → 400', async () => {
    const res = await request(app)
      .patch(`/api/transactions/${transaccionSegundaId}/status`)
      .send({ estado: 'INVALIDO' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/transactions/:id/status — EN_DISPUTA y bordes', () => {
  it('PENDIENTE -> EN_DISPUTA (200)', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_DISPUTA' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('EN_DISPUTA');
  });

  it('EN_REVISION -> EN_DISPUTA (200)', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/c.jpg' });
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_DISPUTA' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('EN_DISPUTA');
  });

  it('EN_DISPUTA -> EN_REVISION (200)', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_DISPUTA' });
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/c2.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('EN_REVISION');
  });

  it('EN_DISPUTA -> COMPLETADO (200)', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_DISPUTA' });
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'COMPLETADO' });
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('COMPLETADO');
  });

  it('PENDIENTE -> EN_REVISION con URL inválida → 400', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'no-es-url' });
    expect(res.status).toBe(400);
  });

  it('EN_REVISION setea fecha_limite a +7 días', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/c.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.data.fecha_limite).toBeDefined();
    const diff = new Date(res.body.data.fecha_limite).getTime() - Date.now();
    expect(diff).toBeGreaterThan(600000000);
    expect(diff).toBeLessThan(650000000);
  });

  it('idempotencia: mismo estado devuelve 200 con mensaje', async () => {
    const txId = await crearTransaccionAislada(usuarioId);
    await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/c.jpg' });
    const res = await request(app).patch(`/api/transactions/${txId}/status`).send({ estado: 'EN_REVISION', comprobante_url: 'https://example.com/c.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('La transacción ya está en ese estado');
  });
});

afterAll(async () => {
  const eventosDelUsuario = await prisma.evento.findMany({ where: { creador_id: usuarioId }, select: { id: true } });
  const ids = eventosDelUsuario.map((e) => e.id);
  if (ids.length > 0) {
    await prisma.transaccion.deleteMany({ where: { evento_id: { in: ids } } });
    await prisma.participante.deleteMany({ where: { evento_id: { in: ids } } });
    await prisma.evento.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.usuario.deleteMany({ where: { id: usuarioId } });
});