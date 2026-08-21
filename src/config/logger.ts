import pino from 'pino';

/** Crea un logger JSON; los campos sensibles se redactan incluso si se agregan por error. */
export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        'cookie',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  });
}

/** Contrato inferido del logger seguro de la aplicación. */
export type AppLogger = ReturnType<typeof createLogger>;
