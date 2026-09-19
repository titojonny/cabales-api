import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import {
  crearConsumoSchema,
  actualizarConsumoSchema,
  agregarPropinaSchema
} from '../validators/consumos.js';
import { repartirCentavosExactos } from '../utils/money.js';

type CuerpoConsumo = z.infer<typeof crearConsumoSchema>;
type CuerpoActualizarConsumo = z.infer<typeof actualizarConsumoSchema>;
type CuerpoPropina = z.infer<typeof agregarPropinaSchema>;

// 1. Registrar un consumo (individual o compartido)
export const registrarConsumo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const evento_id = req.evento!.id;
    const { descripcion, monto_centavos, participante_ids } = req.body as CuerpoConsumo;

    // Sin participantes duplicados en el mismo consumo
    const idsUnicos = [...new Set(participante_ids)];
    if (idsUnicos.length !== participante_ids.length) {
      throw new HttpError(400, 'No puedes enviar el mismo participante dos veces');
    }

    // Todos los participantes deben pertenecer a este evento
    const participantes = await prisma.participante.findMany({
      where: { id: { in: participante_ids }, evento_id },
      select: { id: true }
    });
    if (participantes.length !== participante_ids.length) {
      throw new HttpError(400, 'Algunos participantes no pertenecen a este evento');
    }

    // Reparto exacto: la suma de las partes SIEMPRE cuadra con el total
    const partes = repartirCentavosExactos(monto_centavos, participante_ids.length);

    // Transacción atómica: crear Consumo, desglosar ConsumoParticipante y actualizar balances
    const nuevoConsumo = await prisma.$transaction(async (tx) => {
      const consumo = await tx.consumo.create({
        data: {
          evento_id,
          descripcion: descripcion?.trim() || null,
          monto_centavos,
          participantes: {
            create: participante_ids.map((pId, idx) => ({
              participante_id: pId,
              monto_centavos: partes[idx] ?? 0
            }))
          }
        },
        include: {
          participantes: {
            include: {
              participante: {
                select: {
                  id: true,
                  nombre_invitado: true,
                  usuario: { select: { id: true, nombre: true } }
                }
              }
            }
          }
        }
      });

      for (let i = 0; i < participante_ids.length; i++) {
        await tx.participante.update({
          where: { id: participante_ids[i] ?? '' },
          data: { monto_consumido_centavos: { increment: partes[i] ?? 0 } }
        });
      }

      await tx.evento.update({
        where: { id: evento_id },
        data: { total_gastado_centavos: { increment: monto_centavos } }
      });

      return consumo;
    });

    res.status(201).json({
      success: true,
      message: 'Consumo registrado',
      data: {
        id: nuevoConsumo.id,
        descripcion: nuevoConsumo.descripcion,
        monto_centavos,
        repartido: partes,
        participantes: nuevoConsumo.participantes.map((cp) => ({
          participante_id: cp.participante_id,
          nombre_visible: cp.participante.usuario?.nombre || cp.participante.nombre_invitado || 'Invitado',
          monto_centavos: cp.monto_centavos
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

// 2. Listar consumos de un evento con detalle de participantes
export const obtenerConsumosDeEvento = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const eventoId = assertParamId(req.params.id, 'evento');

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
      select: { id: true }
    });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }

    const consumos = await prisma.consumo.findMany({
      where: { evento_id: eventoId },
      orderBy: { creado_en: 'desc' },
      include: {
        participantes: {
          include: {
            participante: {
              select: {
                id: true,
                nombre_invitado: true,
                usuario_id: true,
                usuario: { select: { id: true, nombre: true, avatar_url: true } }
              }
            }
          }
        }
      }
    });

    const data = consumos.map((c) => ({
      id: c.id,
      evento_id: c.evento_id,
      descripcion: c.descripcion,
      monto_centavos: c.monto_centavos,
      creado_en: c.creado_en,
      participantes: c.participantes.map((cp) => ({
        id: cp.id,
        participante_id: cp.participante_id,
        monto_centavos: cp.monto_centavos,
        nombre_visible: cp.participante.usuario?.nombre || cp.participante.nombre_invitado || 'Invitado',
        es_fantasma: !cp.participante.usuario_id
      }))
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// 3. Actualizar consumo (cambio de monto, descripción o comensales)
export const actualizarConsumo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const eventoId = req.evento!.id;
    const consumoId = assertParamId(req.params.consumoId, 'consumo');
    const { descripcion, monto_centavos, participante_ids } = req.body as CuerpoActualizarConsumo;

    // Validar duplicados en la nueva lista
    const idsUnicos = [...new Set(participante_ids)];
    if (idsUnicos.length !== participante_ids.length) {
      throw new HttpError(400, 'No puedes enviar el mismo participante dos veces');
    }

    // Buscar consumo actual y sus desgloses existentes
    const consumoActual = await prisma.consumo.findFirst({
      where: { id: consumoId, evento_id: eventoId },
      include: { participantes: true }
    });
    if (!consumoActual) {
      throw new HttpError(404, 'El consumo no existe en este evento');
    }

    // Validar que los nuevos participantes pertenezcan al evento
    const nuevosParticipantes = await prisma.participante.findMany({
      where: { id: { in: participante_ids }, evento_id: eventoId },
      select: { id: true }
    });
    if (nuevosParticipantes.length !== participante_ids.length) {
      throw new HttpError(400, 'Algunos participantes no pertenecen a este evento');
    }

    // Reparto exacto nuevo
    const nuevasPartes = repartirCentavosExactos(monto_centavos, participante_ids.length);

    // Transacción atómica: revertir asignaciones viejas y aplicar las nuevas
    const consumoActualizado = await prisma.$transaction(async (tx) => {
      // 1. Revertir montos anteriores en participantes
      for (const cpViejo of consumoActual.participantes) {
        await tx.participante.update({
          where: { id: cpViejo.participante_id },
          data: { monto_consumido_centavos: { decrement: cpViejo.monto_centavos } }
        });
      }

      // 2. Revertir monto anterior en evento
      await tx.evento.update({
        where: { id: eventoId },
        data: { total_gastado_centavos: { decrement: consumoActual.monto_centavos } }
      });

      // 3. Eliminar desgloses viejos
      await tx.consumoParticipante.deleteMany({
        where: { consumo_id: consumoId }
      });

      // 4. Crear desgloses nuevos y actualizar consumo
      const updated = await tx.consumo.update({
        where: { id: consumoId },
        data: {
          descripcion: descripcion?.trim() || null,
          monto_centavos,
          participantes: {
            create: participante_ids.map((pId, idx) => ({
              participante_id: pId,
              monto_centavos: nuevasPartes[idx] ?? 0
            }))
          }
        },
        include: {
          participantes: {
            include: {
              participante: {
                select: {
                  id: true,
                  nombre_invitado: true,
                  usuario: { select: { id: true, nombre: true } }
                }
              }
            }
          }
        }
      });

      // 5. Aplicar montos nuevos en participantes
      for (let i = 0; i < participante_ids.length; i++) {
        await tx.participante.update({
          where: { id: participante_ids[i] ?? '' },
          data: { monto_consumido_centavos: { increment: nuevasPartes[i] ?? 0 } }
        });
      }

      // 6. Aplicar nuevo total al evento
      await tx.evento.update({
        where: { id: eventoId },
        data: { total_gastado_centavos: { increment: monto_centavos } }
      });

      return updated;
    });

    res.json({
      success: true,
      message: 'Consumo actualizado',
      data: {
        id: consumoActualizado.id,
        descripcion: consumoActualizado.descripcion,
        monto_centavos,
        repartido: nuevasPartes,
        participantes: consumoActualizado.participantes.map((cp) => ({
          participante_id: cp.participante_id,
          nombre_visible: cp.participante.usuario?.nombre || cp.participante.nombre_invitado || 'Invitado',
          monto_centavos: cp.monto_centavos
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

// 4. Eliminar consumo (resta atómica en participantes y evento)
export const eliminarConsumo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const eventoId = req.evento!.id;
    const consumoId = assertParamId(req.params.consumoId, 'consumo');

    const consumo = await prisma.consumo.findFirst({
      where: { id: consumoId, evento_id: eventoId },
      include: { participantes: true }
    });
    if (!consumo) {
      throw new HttpError(404, 'El consumo no existe en este evento');
    }

    await prisma.$transaction(async (tx) => {
      // Revertir montos a cada comensal
      for (const cp of consumo.participantes) {
        await tx.participante.update({
          where: { id: cp.participante_id },
          data: { monto_consumido_centavos: { decrement: cp.monto_centavos } }
        });
      }

      // Revertir total del evento
      await tx.evento.update({
        where: { id: eventoId },
        data: { total_gastado_centavos: { decrement: consumo.monto_centavos } }
      });

      // Eliminar consumo (cascada elimina ConsumoParticipante)
      await tx.consumo.delete({
        where: { id: consumoId }
      });
    });

    res.json({
      success: true,
      message: 'Consumo eliminado con éxito'
    });
  } catch (error) {
    next(error);
  }
};

// 5. Agregar propina automática sugerida (10% por defecto)
export const agregarPropina = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const eventoId = req.evento!.id;
    const { porcentaje = 10, participante_ids } = (req.body || {}) as CuerpoPropina;

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
      include: { participantes: { select: { id: true } } }
    });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }

    if (evento.participantes.length === 0) {
      throw new HttpError(400, 'No hay comensales en la mesa para repartir la propina');
    }

    if (evento.total_gastado_centavos === 0) {
      throw new HttpError(400, 'No hay consumos previos en la mesa para calcular propina');
    }

    // Comensales destino (todos o subset especificado)
    const targetIds = participante_ids && participante_ids.length > 0
      ? participante_ids
      : evento.participantes.map((p) => p.id);

    // Validar que pertenezcan al evento
    const validos = evento.participantes.filter((p) => targetIds.includes(p.id));
    if (validos.length !== targetIds.length) {
      throw new HttpError(400, 'Algunos participantes no pertenecen a este evento');
    }

    // Cálculo del 10% (o porcentaje elegido)
    const propinaCentavos = Math.max(1, Math.round((evento.total_gastado_centavos * porcentaje) / 100));
    const partes = repartirCentavosExactos(propinaCentavos, targetIds.length);
    const descripcion = `Propina de Servicio (${porcentaje}%)`;

    // Transacción atómica
    const consumoPropina = await prisma.$transaction(async (tx) => {
      const consumo = await tx.consumo.create({
        data: {
          evento_id: eventoId,
          descripcion,
          monto_centavos: propinaCentavos,
          participantes: {
            create: targetIds.map((pId, idx) => ({
              participante_id: pId,
              monto_centavos: partes[idx] ?? 0
            }))
          }
        },
        include: {
          participantes: {
            include: {
              participante: {
                select: {
                  id: true,
                  nombre_invitado: true,
                  usuario: { select: { id: true, nombre: true } }
                }
              }
            }
          }
        }
      });

      for (let i = 0; i < targetIds.length; i++) {
        await tx.participante.update({
          where: { id: targetIds[i] ?? '' },
          data: { monto_consumido_centavos: { increment: partes[i] ?? 0 } }
        });
      }

      await tx.evento.update({
        where: { id: eventoId },
        data: { total_gastado_centavos: { increment: propinaCentavos } }
      });

      return consumo;
    });

    res.status(201).json({
      success: true,
      message: 'Propina agregada a la mesa',
      data: {
        id: consumoPropina.id,
        descripcion,
        monto_centavos: propinaCentavos,
        porcentaje,
        repartido: partes,
        participantes: consumoPropina.participantes.map((cp) => ({
          participante_id: cp.participante_id,
          nombre_visible: cp.participante.usuario?.nombre || cp.participante.nombre_invitado || 'Invitado',
          monto_centavos: cp.monto_centavos
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};