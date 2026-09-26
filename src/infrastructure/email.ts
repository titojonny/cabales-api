export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Puerto de correo; la implementación de producción se inyecta desde la composición. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Proveedor local seguro: no envía correo y permite verificar el flujo en desarrollo. */
export class LoggingEmailProvider implements EmailProvider {
  constructor(private readonly write: (message: EmailMessage) => void = console.info) {}

  async send(message: EmailMessage): Promise<void> {
    this.write({ ...message, text: '[local email suppressed]' });
  }
}
