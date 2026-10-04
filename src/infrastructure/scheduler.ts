import { Prisma } from '@prisma/client';
import type { AppLogger } from '../config/logger.js';
import type { Database } from '../database/client.js';
import type { DistributedLock } from './rate-limit.js';

export interface SchedulerClock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const systemClock: SchedulerClock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface JobExecutionStore {
  claim(jobKey: string, now: Date, maxAttempts: number, staleAfterMs: number): Promise<boolean>;
  complete(jobKey: string, now: Date): Promise<void>;
  fail(jobKey: string, now: Date, errorCode: string): Promise<void>;
}

/** Persistencia en PostgreSQL: una clave de ventana solo se ejecuta una vez con éxito. */
export class PrismaJobExecutionStore implements JobExecutionStore {
  constructor(private readonly db: Database) {}

  async claim(jobKey: string, now: Date, maxAttempts: number, staleAfterMs: number) {
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await tx.scheduledJobRun.findUnique({ where: { jobKey } });
        if (current?.status === 'SUCCEEDED') return false;
        if (
          current?.status === 'RUNNING' &&
          now.getTime() - current.updatedAt.getTime() < staleAfterMs
        )
          return false;
        if (current && current.status === 'FAILED' && current.attempts >= maxAttempts) return false;

        if (current) {
          await tx.scheduledJobRun.update({
            where: { jobKey },
            data: {
              status: 'RUNNING',
              attempts: { increment: 1 },
              startedAt: now,
              finishedAt: null,
              lastErrorCode: null,
              updatedAt: now,
            },
          });
        } else {
          await tx.scheduledJobRun.create({
            data: { jobKey, status: 'RUNNING', attempts: 1, startedAt: now, updatedAt: now },
          });
        }
        return true;
      });
    } catch (error) {
      // Dos procesos pueden observar la ausencia de una clave; el único que gana P2002 ejecuta.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return false;
      throw error;
    }
  }

  async complete(jobKey: string, now: Date) {
    await this.db.scheduledJobRun.updateMany({
      where: { jobKey, status: 'RUNNING' },
      data: { status: 'SUCCEEDED', finishedAt: now, updatedAt: now },
    });
  }

  async fail(jobKey: string, now: Date, errorCode: string) {
    await this.db.scheduledJobRun.updateMany({
      where: { jobKey, status: 'RUNNING' },
      data: { status: 'FAILED', finishedAt: now, lastErrorCode: errorCode, updatedAt: now },
    });
  }
}

/** Store pequeño para pruebas unitarias del planificador sin PostgreSQL. */
export class InMemoryJobExecutionStore implements JobExecutionStore {
  private readonly rows = new Map<
    string,
    { status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; attempts: number; updatedAt: number }
  >();

  async claim(jobKey: string, now: Date, maxAttempts: number, staleAfterMs: number) {
    const current = this.rows.get(jobKey);
    if (current?.status === 'SUCCEEDED') return false;
    if (current?.status === 'RUNNING' && now.getTime() - current.updatedAt < staleAfterMs)
      return false;
    if (current?.status === 'FAILED' && current.attempts >= maxAttempts) return false;
    this.rows.set(jobKey, {
      status: 'RUNNING',
      attempts: (current?.attempts ?? 0) + 1,
      updatedAt: now.getTime(),
    });
    return true;
  }

  async complete(jobKey: string, now: Date) {
    const current = this.rows.get(jobKey);
    if (current)
      this.rows.set(jobKey, { ...current, status: 'SUCCEEDED', updatedAt: now.getTime() });
  }

  async fail(jobKey: string, now: Date) {
    const current = this.rows.get(jobKey);
    if (current) this.rows.set(jobKey, { ...current, status: 'FAILED', updatedAt: now.getTime() });
  }
}

/** Lock PostgreSQL transaccional; mantiene la misma conexión durante todo el trabajo. */
export class PostgresAdvisoryLock implements DistributedLock {
  constructor(private readonly db: Database) {}

  async runExclusive<T>(key: string, _ttlMs: number, task: () => Promise<T>) {
    let acquired = false;
    let result: T | undefined;
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`,
      );
      acquired = rows[0]?.locked === true;
      if (acquired) result = await task();
    });
    if (!acquired) return { acquired: false };
    return { acquired: true, result: result as T };
  }
}

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  maxAttempts?: number;
  lockTtlMs?: number;
  retryDelayMs?: number;
  initialDelayMs?: number;
  key?: (now: Date) => string;
  run: (context: { now: Date; jobKey: string }) => Promise<void>;
}

export interface TaskSchedulerOptions {
  enabled?: boolean;
  clock?: SchedulerClock;
  store: JobExecutionStore;
  lock: DistributedLock;
  logger?: Pick<AppLogger, 'error' | 'warn'>;
  defaultMaxAttempts?: number;
  lockTtlMs?: number;
}

/** Planificador periódico reutilizable, idempotente, con lock distribuido y cierre limpio. */
export class TaskScheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly clock: SchedulerClock;
  private started = false;
  private stopping = false;

  constructor(private readonly options: TaskSchedulerOptions) {
    this.clock = options.clock ?? systemClock;
  }

  register(job: ScheduledJob): void {
    if (job.intervalMs < 1000) throw new Error('SCHEDULER_INTERVAL_TOO_SHORT');
    if (this.jobs.has(job.name)) throw new Error(`SCHEDULER_DUPLICATE_JOB:${job.name}`);
    this.jobs.set(job.name, job);
    if (this.started && !this.stopping) this.schedule(job, job.initialDelayMs ?? job.intervalMs);
  }

  start(): void {
    if (this.started || this.stopping || this.options.enabled === false) return;
    this.started = true;
    for (const job of this.jobs.values()) this.schedule(job, job.initialDelayMs ?? job.intervalMs);
  }

  async runNow(name: string, at = this.clock.now()): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`SCHEDULER_JOB_NOT_FOUND:${name}`);
    await this.execute(job, at);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private schedule(job: ScheduledJob, delayMs: number): void {
    const timer = this.clock.setTimeout(
      () => {
        this.timers.delete(job.name);
        const promise = this.execute(job, this.clock.now()).catch(() => undefined);
        this.pending.add(promise);
        void promise.then(() => {
          this.pending.delete(promise);
          if (this.started && !this.stopping) this.schedule(job, job.intervalMs);
        });
      },
      Math.max(0, delayMs),
    );
    this.timers.set(job.name, timer);
  }

  private async execute(job: ScheduledJob, now: Date): Promise<void> {
    const jobKey = job.key?.(now) ?? `${job.name}:${Math.floor(now.getTime() / job.intervalMs)}`;
    const maxAttempts = job.maxAttempts ?? this.options.defaultMaxAttempts ?? 3;
    const lockTtlMs =
      job.lockTtlMs ?? this.options.lockTtlMs ?? Math.max(job.intervalMs * 2, 60_000);
    const retryDelayMs = job.retryDelayMs ?? Math.min(1000, Math.max(100, job.intervalMs / 10));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const outcome = await this.options.lock.runExclusive(jobKey, lockTtlMs, async () => {
          const claimed = await this.options.store.claim(jobKey, now, maxAttempts, lockTtlMs);
          if (!claimed) return false;
          try {
            await job.run({ now, jobKey });
            await this.options.store.complete(jobKey, this.clock.now());
            return true;
          } catch (error) {
            await this.options.store.fail(jobKey, this.clock.now(), errorCode(error));
            throw error;
          }
        });
        if (!outcome.acquired || outcome.result === false) return;
        return;
      } catch (error) {
        if (attempt >= maxAttempts) {
          this.options.logger?.error(
            { job: job.name, code: errorCode(error), attempts: maxAttempts },
            'Trabajo programado agotó sus reintentos',
          );
          return;
        }
        await this.delay(retryDelayMs * attempt);
      }
    }
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.setTimeout(resolve, delayMs);
    });
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code).slice(0, 80);
  return 'UNKNOWN';
}
