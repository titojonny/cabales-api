import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const email = `test-${Date.now()}@example.com`;
let userId = '';

describe('Flujo relacional de Cabales', () => {
  it('GET /api/health responde que está vivo', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/users crea un usuario', async () => {
    const res = await request(app).post('/api/users').send({ nombre: 'Usuario Test', email });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(email);
    userId = res.body.data.id;
  });

  it('POST /api/users rechaza un email inválido', async () => {
    const res = await request(app).post('/api/users').send({ nombre: 'X', email: 'no-es-un-email' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/users con email duplicado da 409', async () => {
    const res = await request(app).post('/api/users').send({ nombre: 'Otro', email });
    expect(res.status).toBe(409);
  });

  it('POST /api/events crea un evento anclado al usuario', async () => {
    const res = await request(app).post('/api/events').send({ nombre: 'Cena por el proyecto', creador_id: userId });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.creador_id).toBe(userId);
    expect(res.body.data.estado).toBe('ACTIVO');
    expect(res.body.data.total_gastado_centavos).toBe(0);
  });

  it('POST /api/events con creador inexistente da 404', async () => {
    const res = await request(app).post('/api/events').send({
      nombre: 'Evento fantasma',
      creador_id: '00000000-0000-0000-0000-000000000000'
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/events con creador_id inválido da 400', async () => {
    const res = await request(app).post('/api/events').send({ nombre: 'X', creador_id: 'no-es-uuid' });
    expect(res.status).toBe(400);
  });

  it('una ruta inexistente da 404 con envelope unificado', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

afterAll(async () => {
  await prisma.evento.deleteMany({ where: { creador_id: userId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
});