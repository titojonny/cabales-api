import { ExternalProviderError } from './errors.js';

/** Opciones del cliente HTTP saliente con timeout y reintentos acotados. */
export interface OutboundOptions {
  provider: string;
  timeoutMs: number;
  /** Reintentos adicionales ante red o 5xx/429; nunca ante 4xx funcionales. */
  retries?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta una petición saliente sin registrar cuerpos ni cabeceras.
 * Lanza ExternalProviderError con códigos estables cuando se agotan los intentos.
 */
export async function outboundFetch(
  url: string,
  init: RequestInit,
  options: OutboundOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = 1 + Math.max(0, Math.min(options.retries ?? 2, 5));
  let lastCode = 'UNKNOWN';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.ok) return response;
      lastCode = `HTTP_${response.status}`;
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable) throw new ExternalProviderError(options.provider, lastCode, false);
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      lastCode =
        error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
    }
    if (attempt < attempts) await sleep(Math.min(2000, 200 * 2 ** (attempt - 1)));
  }
  throw new ExternalProviderError(options.provider, lastCode, true);
}
