import { Prisma } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';

// Error con código HTTP explícito para errores de negocio controlados
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Mapeo central de errores conocidos de Prisma a respuestas HTTP limpias
const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: 'Ya existe un registro con esos datos' },
  P2003: { status: 400, message: 'Referencia a un registro que no existe' },
  P2025: { status: 404, message: 'Registro no encontrado' },
};

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): { status: number; message: string } {
  return PRISMA_ERROR_MAP[error.code] ?? { status: 400, message: 'Error de base de datos' };
}

// Ruta no encontrada (debe registrarse después de todas las rutas)
export function notFound(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
}

// Manejador central de errores (debe registrarse al final, después de notFound)
// En Express 5 los controladores async propagan sus rechazos solos hasta aquí.
export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const { status, message } = mapPrismaError(error);
    res.status(status).json({ success: false, message });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, message: error.message });
    return;
  }

  console.error('Error interno:', error);
  const mensaje =
    process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : error instanceof Error
        ? error.message
        : 'Error interno del servidor';

  res.status(500).json({ success: false, message: 'Error interno del servidor', ...(mensaje ? { error: [mensaje] } : {}) });
}