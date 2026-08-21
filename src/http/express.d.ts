import type { AuthContext } from '../modules/auth/auth.service.js';

declare global {
  namespace Express {
    /** Contexto confiable agregado por los middlewares transversales. */
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

export {};
