import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { crearUsuario, crearEvento, agregarParticipanteFantasma } from './helpers/factory.js';

describe('Gestión de Identidad y Reclamo de Comensales (Fase 5)', () => {
  describe('PATCH /api/users/:id (Actualizar Perfil)', () => {
    it('actualiza el nombre y avatar del usuario exitosamente (200)', async () => {
      const u = await crearUsuario();

      const res = await request(app)
        .patch(`/api/users/${u.id}`)
        .send({
          nombre: 'Nombre Nuevo',
          avatar_url: 'https://example.com/avatar.jpg'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nombre).toBe('Nombre Nuevo');
      expect(res.body.data.avatar_url).toBe('https://example.com/avatar.jpg');
    });

    it('falla con 404 si el usuario no existe', async () => {
      const res = await request(app)
        .patch('/api/users/00000000-0000-0000-0000-000000000000')
        .send({ nombre: 'Fantasma' });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/no existe/i);
    });

    it('falla con 400 si se envía un cuerpo vacío', async () => {
      const u = await crearUsuario();
      const res = await request(app)
        .patch(`/api/users/${u.id}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/events/:id/participants/:participantId/claim (Reclamar Comensal en Mesa)', () => {
    it('permite a un usuario real reclamar un comensal fantasma previamente creado (200)', async () => {
      const org = await crearUsuario();
      const mesa = await crearEvento(org.id, 'Cena Viernes');
      const pFantasma = await agregarParticipanteFantasma(mesa.id, 'Kevin');

      const usuarioKevin = await crearUsuario();

      const res = await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma.id}/claim`)
        .send({ usuario_id: usuarioKevin.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.usuario_id).toBe(usuarioKevin.id);
      expect(res.body.data.usuario.nombre).toBe('Test User');
    });

    it('es idempotente si el mismo usuario vuelve a reclamar el mismo asiento (200)', async () => {
      const org = await crearUsuario();
      const mesa = await crearEvento(org.id, 'Almuerzo');
      const pFantasma = await agregarParticipanteFantasma(mesa.id, 'Sofía');

      const usuarioSofia = await crearUsuario();

      await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma.id}/claim`)
        .send({ usuario_id: usuarioSofia.id });

      const resSegunda = await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma.id}/claim`)
        .send({ usuario_id: usuarioSofia.id });

      expect(resSegunda.status).toBe(200);
      expect(resSegunda.body.success).toBe(true);
      expect(resSegunda.body.data.usuario_id).toBe(usuarioSofia.id);
    });

    it('rechaza con 409 si otro usuario intenta reclamar un comensal que ya tiene usuario asignado', async () => {
      const org = await crearUsuario();
      const mesa = await crearEvento(org.id, 'Asado');
      const pFantasma = await agregarParticipanteFantasma(mesa.id, 'Pedro');

      const usuarioPedro1 = await crearUsuario();
      const usuarioPedro2 = await crearUsuario();

      // Pedro 1 reclama
      await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma.id}/claim`)
        .send({ usuario_id: usuarioPedro1.id });

      // Pedro 2 intenta reclamar el mismo asiento
      const resConflicto = await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma.id}/claim`)
        .send({ usuario_id: usuarioPedro2.id });

      expect(resConflicto.status).toBe(409);
      expect(resConflicto.body.message).toMatch(/ya ha sido reclamado/i);
    });

    it('rechaza con 409 si el usuario ya está sentado en la mesa en otro lugar', async () => {
      const org = await crearUsuario();
      const mesa = await crearEvento(org.id, 'Picnic');
      const pFantasma1 = await agregarParticipanteFantasma(mesa.id, 'Lugar 1');
      const pFantasma2 = await agregarParticipanteFantasma(mesa.id, 'Lugar 2');

      const usuarioUnico = await crearUsuario();

      // Reclama el lugar 1
      await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma1.id}/claim`)
        .send({ usuario_id: usuarioUnico.id });

      // Intenta reclamar también el lugar 2
      const resDobleAsiento = await request(app)
        .patch(`/api/events/${mesa.id}/participants/${pFantasma2.id}/claim`)
        .send({ usuario_id: usuarioUnico.id });

      expect(resDobleAsiento.status).toBe(409);
      expect(resDobleAsiento.body.message).toMatch(/ya tienes otro lugar asignado/i);
    });
  });
});
