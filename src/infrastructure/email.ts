import { outboundFetch } from './http-client.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Puerto de correo; la implementación de producción se inyecta desde la composición. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Enmascara un correo para logs operacionales: conserva dominio y primera letra. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Proveedor local seguro: no envía correo ni registra enlaces con tokens. */
export class LoggingEmailProvider implements EmailProvider {
  readonly name = 'logging';
  constructor(
    private readonly write: (entry: { to: string; subject: string }) => void = (entry) =>
      console.info({ email: entry }, 'Correo local suprimido'),
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.write({ to: maskEmail(message.to), subject: message.subject });
  }
}

/** Proveedor HTTP con contrato compatible con APIs tipo Resend (`from`, `to`, `subject`, `text`, `html`). */
export class HttpEmailProvider implements EmailProvider {
  readonly name = 'http';
  constructor(
    private readonly options: {
      url: string;
      apiKey: string;
      from: string;
      timeoutMs: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await outboundFetch(
      this.options.url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      },
      {
        provider: 'email',
        timeoutMs: this.options.timeoutMs,
        retries: 2,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      },
    );
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === '&'
      ? '&amp;'
      : char === '<'
        ? '&lt;'
        : char === '>'
          ? '&gt;'
          : char === '"'
            ? '&quot;'
            : '&#39;',
  );
}

function layout(title: string, intro: string, actionLabel: string, url: string, footer: string) {
  const text = `${intro}\n\n${actionLabel}: ${url}\n\n${footer}`;
  const html = `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#10142c">
<h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#5b5bd6;color:#fff;border-radius:10px;text-decoration:none">${escapeHtml(actionLabel)}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(footer)}</p></body></html>`;
  return { text, html };
}

/** Plantillas transaccionales en español; los tokens viajan en el fragmento (#) para no llegar a logs. */
export const emailTemplates = {
  verifyEmail(appOrigin: string, token: string, ttlHours: number): Omit<EmailMessage, 'to'> {
    const url = `${appOrigin}/verify-email#token=${encodeURIComponent(token)}`;
    return {
      subject: 'Verifica tu correo de Cabales',
      ...layout(
        'Verifica tu correo',
        'Confirma que este correo te pertenece para proteger tu cuenta de Cabales.',
        'Verificar correo',
        url,
        `El enlace vence en ${ttlHours} horas. Si no creaste una cuenta, ignora este mensaje.`,
      ),
    };
  },
  resetPassword(appOrigin: string, token: string, ttlMinutes: number): Omit<EmailMessage, 'to'> {
    const url = `${appOrigin}/reset-password#token=${encodeURIComponent(token)}`;
    return {
      subject: 'Recupera tu acceso a Cabales',
      ...layout(
        'Define una nueva contraseña',
        'Recibimos una solicitud para recuperar el acceso a tu cuenta.',
        'Crear nueva contraseña',
        url,
        `El enlace vence en ${ttlMinutes} minutos y solo funciona una vez. Si no lo pediste, ignora este mensaje: tu contraseña no cambiará.`,
      ),
    };
  },
  invitation(
    appOrigin: string,
    token: string,
    groupName: string,
    inviterName: string,
    ttlDays: number,
  ): Omit<EmailMessage, 'to'> {
    const url = `${appOrigin}/app/invitations/accept#token=${encodeURIComponent(token)}`;
    return {
      subject: `${inviterName} te invitó a ${groupName} en Cabales`,
      ...layout(
        'Tienes una invitación',
        `${inviterName} te invitó a unirte al grupo "${groupName}" para compartir gastos.`,
        'Ver invitación',
        url,
        `La invitación vence en ${ttlDays} días. Debes iniciar sesión con este mismo correo para aceptarla.`,
      ),
    };
  },
  notification(appOrigin: string, title: string, body: string): Omit<EmailMessage, 'to'> {
    return {
      subject: `Cabales: ${title}`,
      ...layout(
        title,
        body,
        'Abrir Cabales',
        `${appOrigin}/app/notifications`,
        'Puedes cambiar tus preferencias de avisos desde la app.',
      ),
    };
  },
};
