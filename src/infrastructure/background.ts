import type { AppLogger } from '../config/logger.js';

/**
 * Ejecuta trabajo en segundo plano sin bloquear la respuesta HTTP (anti-enumeración por tiempo).
 * Registra fallos con un nombre estable y permite drenar tareas en pruebas y cierre controlado.
 */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly logger?: Pick<AppLogger, 'error'>) {}

  run(name: string, task: () => Promise<unknown>): void {
    const promise = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'UNKNOWN';
          this.logger?.error({ task: name, code }, 'Tarea en segundo plano fallida');
        },
      )
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  /** Espera a que terminen todas las tareas en curso, incluidas las encadenadas. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
