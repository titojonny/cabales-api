import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryJobExecutionStore,
  TaskScheduler,
  type SchedulerClock,
} from '../src/infrastructure/scheduler.js';

const immediateClock: SchedulerClock = {
  now: () => new Date('2026-10-03T12:00:00.000Z'),
  setTimeout: (callback) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  },
  clearTimeout: vi.fn(),
};

const lock = {
  runExclusive: async <T>(_key: string, _ttlMs: number, task: () => Promise<T>) => ({
    acquired: true,
    result: await task(),
  }),
};

describe('TaskScheduler', () => {
  it('es idempotente por clave y usa reloj inyectable', async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new TaskScheduler({
      clock: immediateClock,
      store: new InMemoryJobExecutionStore(),
      lock,
    });
    scheduler.register({ name: 'test', intervalMs: 60_000, run });

    await scheduler.runNow('test');
    await scheduler.runNow('test');

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      now: new Date('2026-10-03T12:00:00.000Z'),
      jobKey: 'test:29850480',
    });
  });

  it('reintenta de forma acotada y marca éxito al converger', async () => {
    let attempts = 0;
    const scheduler = new TaskScheduler({
      clock: immediateClock,
      store: new InMemoryJobExecutionStore(),
      lock,
      defaultMaxAttempts: 3,
    });
    scheduler.register({
      name: 'retry',
      intervalMs: 60_000,
      retryDelayMs: 0,
      run: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
      },
    });

    await scheduler.runNow('retry');
    await scheduler.runNow('retry');

    expect(attempts).toBe(3);
  });

  it('no programa trabajos cuando está desactivado', () => {
    const scheduler = new TaskScheduler({
      enabled: false,
      clock: immediateClock,
      store: new InMemoryJobExecutionStore(),
      lock,
    });
    scheduler.register({ name: 'disabled', intervalMs: 60_000, run: vi.fn() });
    scheduler.start();
    expect(immediateClock.clearTimeout).not.toHaveBeenCalled();
  });
});
