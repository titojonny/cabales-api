import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { crearUsuario, crearEvento, agregarParticipanteUsuario } from './helpers/factory.js';

describe('CRUD de Consumos y Propina Automática', () => {
  it('registra, lista, edita, elimina consumos y agrega propina del 10%', async () => {
    // 1. Setup inicial de evento y 3 comensales
    const u1 = await crearUsuario();
    const u2 = await crearUsuario();
    const u3 = await crearUsuario();

    const ev = await crearEvento(u1.id, 'Salida Tacos y Cervezas');
    const p1 = await agregarParticipanteUsuario(ev.id, u1.id);
    const p2 = await agregarParticipanteUsuario(ev.id, u2.id);
    const p3 = await agregarParticipanteUsuario(ev.id, u3.id);

    // 2. Registrar Consumo Inicial: Pizza $15.00 (1500 centavos) entre p1, p2, p3
    const resCrear = await request(app)
      .post(`/api/events/${ev.id}/consumptions`)
      .send({
        descripcion: 'Pizza Suprema',
        monto_centavos: 1500,
        participante_ids: [p1.id, p2.id, p3.id]
      });

    expect(resCrear.status).toBe(201);
    expect(resCrear.body.success).toBe(true);
    const consumoId = resCrear.body.data.id;
    expect(resCrear.body.data.repartido).toEqual([500, 500, 500]);

    // 3. Listar Consumos del evento
    const resListar = await request(app).get(`/api/events/${ev.id}/consumptions`);
    expect(resListar.status).toBe(200);
    expect(resListar.body.success).toBe(true);
    expect(resListar.body.data.length).toBe(1);
    expect(resListar.body.data[0].descripcion).toBe('Pizza Suprema');
    expect(resListar.body.data[0].monto_centavos).toBe(1500);
    expect(resListar.body.data[0].participantes.length).toBe(3);

    // 4. Modificar Consumo (PUT): Ahora fueron $18.00 (1800 centavos) pero solo entre p1 y p2
    const resEditar = await request(app)
      .put(`/api/events/${ev.id}/consumptions/${consumoId}`)
      .send({
        descripcion: 'Pizza Grande + Extra Queso',
        monto_centavos: 1800,
        participante_ids: [p1.id, p2.id]
      });

    expect(resEditar.status).toBe(200);
    expect(resEditar.body.success).toBe(true);
    expect(resEditar.body.data.descripcion).toBe('Pizza Grande + Extra Queso');
    expect(resEditar.body.data.repartido).toEqual([900, 900]);

    // Verificar en BD que p3 ya no tiene consumo y p1, p2 tienen 900
    const [dbP1, dbP2, dbP3, dbEv] = await Promise.all([
      prisma.participante.findUniqueOrThrow({ where: { id: p1.id } }),
      prisma.participante.findUniqueOrThrow({ where: { id: p2.id } }),
      prisma.participante.findUniqueOrThrow({ where: { id: p3.id } }),
      prisma.evento.findUniqueOrThrow({ where: { id: ev.id } })
    ]);

    expect(dbP1.monto_consumido_centavos).toBe(900);
    expect(dbP2.monto_consumido_centavos).toBe(900);
    expect(dbP3.monto_consumido_centavos).toBe(0);
    expect(dbEv.total_gastado_centavos).toBe(1800);

    // 5. Agregar Propina 10%
    const resPropina = await request(app)
      .post(`/api/events/${ev.id}/tip`)
      .send({ porcentaje: 10 });

    expect(resPropina.status).toBe(201);
    expect(resPropina.body.success).toBe(true);
    // 10% de 1800 = 180 centavos. Repartido entre los 3 participantes del evento = 60 c/u
    expect(resPropina.body.data.monto_centavos).toBe(180);
    expect(resPropina.body.data.repartido).toEqual([60, 60, 60]);

    // Verificar total con propina: 1800 + 180 = 1980
    const evConPropina = await prisma.evento.findUniqueOrThrow({ where: { id: ev.id } });
    expect(evConPropina.total_gastado_centavos).toBe(1980);

    // 6. Eliminar el consumo de la pizza (DELETE)
    const resEliminar = await request(app).delete(
      `/api/events/${ev.id}/consumptions/${consumoId}`
    );
    expect(resEliminar.status).toBe(200);
    expect(resEliminar.body.success).toBe(true);

    // Tras eliminar la pizza de 1800, solo debe quedar la propina de 180
    const evTrasDelete = await prisma.evento.findUniqueOrThrow({ where: { id: ev.id } });
    expect(evTrasDelete.total_gastado_centavos).toBe(180);

    const p1TrasDelete = await prisma.participante.findUniqueOrThrow({ where: { id: p1.id } });
    expect(p1TrasDelete.monto_consumido_centavos).toBe(60);
  });

  it('rechaza editar o eliminar consumos de un evento CERRADO (409)', async () => {
    const u1 = await crearUsuario();
    const u2 = await crearUsuario();
    const ev = await crearEvento(u1.id, 'Evento Que Se Va a Cerrar');
    const p1 = await agregarParticipanteUsuario(ev.id, u1.id);
    const p2 = await agregarParticipanteUsuario(ev.id, u2.id);

    const resCrear = await request(app)
      .post(`/api/events/${ev.id}/consumptions`)
      .send({ monto_centavos: 2000, participante_ids: [p1.id, p2.id] });
    const cId = resCrear.body.data.id;

    // Registrar pago para equilibrar y cerrar
    await request(app).post(`/api/events/${ev.id}/payments`).send({ participante_id: p1.id, monto_centavos: 2000 });
    const resClose = await request(app).post(`/api/events/${ev.id}/close`);
    expect(resClose.status).toBe(201);

    // Intentar editar
    const resPut = await request(app)
      .put(`/api/events/${ev.id}/consumptions/${cId}`)
      .send({ monto_centavos: 3000, participante_ids: [p1.id] });
    expect(resPut.status).toBe(409);

    // Intentar eliminar
    const resDel = await request(app).delete(`/api/events/${ev.id}/consumptions/${cId}`);
    expect(resDel.status).toBe(409);

    // Intentar propina en evento cerrado
    const resTip = await request(app).post(`/api/events/${ev.id}/tip`).send({ porcentaje: 10 });
    expect(resTip.status).toBe(409);
  });
});
