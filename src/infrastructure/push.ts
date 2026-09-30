import webpush from 'web-push';
import type { PushSubscription as WebPushSubscription } from 'web-push';
import { ExternalProviderError } from './errors.js';

/** Suscripción Web Push persistida por el usuario. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Error controlado que conserva el estado HTTP sin incluir el endpoint ni secretos. */
export class PushProviderError extends ExternalProviderError {
  constructor(
    code: string,
    retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super('push', code, retryable);
  }
}

/** Puerto de push; la ausencia de proveedor degrada a avisos dentro de la app. */
export interface NotificationPushProvider {
  readonly name: string;
  readonly enabled: boolean;
  readonly publicKey?: string | null;
  send(
    target: PushTarget,
    payload: { title: string; body: string; url?: string },
  ): Promise<boolean>;
}

/** Doble local: no envía nada y reporta que el canal no está disponible. */
export class DisabledPushProvider implements NotificationPushProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  readonly publicKey = null;
  async send(): Promise<boolean> {
    return false;
  }
}

/** Web Push real con VAPID; las claves solo llegan desde variables de entorno. */
export class WebPushProvider implements NotificationPushProvider {
  readonly name = 'webpush';
  readonly enabled = true;
  readonly publicKey: string;

  private static readonly TTL_SECONDS = 3600;
  private static readonly MAX_RETRY_AFTER_MS = 60_000;

  constructor(
    private readonly options: {
      publicKey: string;
      privateKey: string;
      subject: string;
      timeoutMs: number;
      retries?: number;
      logger?: { warn: (obj: object, message: string) => void };
      sendImpl?: (subscription: WebPushSubscription, payload: string) => Promise<unknown>;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.publicKey = options.publicKey;
  }

  async send(target: PushTarget, payload: { title: string; body: string; url?: string }) {
    const sendImpl =
      this.options.sendImpl ??
      ((subscription: WebPushSubscription, body: string) => this.sendRequest(subscription, body));
    const attempts = 1 + Math.min(Math.max(this.options.retries ?? 2, 0), 3);
    let lastError: PushProviderError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.withTimeout(
          sendImpl(
            { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
            JSON.stringify(payload),
          ),
        );
        return true;
      } catch (error) {
        const statusCode = this.statusCode(error);
        const retryAfterMs = this.retryAfterMs(error);
        const retryable =
          statusCode === undefined ||
          statusCode >= 500 ||
          (statusCode === 429 && retryAfterMs !== undefined);
        lastError = new PushProviderError(
          statusCode === 404 || statusCode === 410
            ? 'SUBSCRIPTION_GONE'
            : statusCode
              ? `HTTP_${statusCode}`
              : error instanceof DOMException && error.name === 'TimeoutError'
                ? 'TIMEOUT'
                : 'NETWORK',
          retryable && statusCode !== 404 && statusCode !== 410,
          statusCode,
        );
        if (!lastError.retryable || attempt === attempts) break;
        const delayMs = retryAfterMs ?? Math.min(1000, 100 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    this.options.logger?.warn(
      { provider: this.name, code: lastError?.code, statusCode: lastError?.statusCode },
      'Entrega push fallida',
    );
    throw lastError ?? new PushProviderError('UNKNOWN', true);
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new DOMException('Timeout', 'TimeoutError')),
        this.options.timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private statusCode(error: unknown): number | undefined {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }

  private retryAfterMs(error: unknown): number | undefined {
    const retryAfterMs = (error as { retryAfterMs?: unknown })?.retryAfterMs;
    return typeof retryAfterMs === 'number' &&
      retryAfterMs >= 0 &&
      retryAfterMs <= WebPushProvider.MAX_RETRY_AFTER_MS
      ? retryAfterMs
      : undefined;
  }

  private async sendRequest(subscription: WebPushSubscription, body: string): Promise<void> {
    const request = webpush.generateRequestDetails(subscription, body, {
      contentEncoding: 'aes128gcm',
      TTL: WebPushProvider.TTL_SECONDS,
      vapidDetails: {
        subject: this.options.subject,
        publicKey: this.options.publicKey,
        privateKey: this.options.privateKey,
      },
    });
    const response = await (this.options.fetchImpl ?? fetch)(request.endpoint, {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [name, String(value)]),
      ),
      body: request.body,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (response.ok) return;

    const error = new Error(`Push endpoint returned HTTP ${response.status}`) as Error & {
      statusCode: number;
      retryAfterMs?: number;
    };
    error.statusCode = response.status;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const retryAt = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(retryAt) && retryAt >= 0) error.retryAfterMs = retryAt;
    }
    throw error;
  }
}
