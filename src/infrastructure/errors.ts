/** Fallo explícito de un proveedor externo; el código es estable y nunca contiene secretos. */
export class ExternalProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(`${provider}: ${code}`);
    this.name = 'ExternalProviderError';
  }
}
