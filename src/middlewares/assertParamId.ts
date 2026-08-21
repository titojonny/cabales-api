import { HttpError } from './errorHandler.js';

// Valida que un parámetro de ruta sea un string no vacío
// Acepta string | string[] | undefined (Express params pueden ser arrays)
export function assertParamId(id: string | string[] | undefined, recurso = 'recurso'): string {
  const valor = Array.isArray(id) ? id[0] : id;
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new HttpError(400, `Falta el id del ${recurso}`);
  }
  return valor;
}