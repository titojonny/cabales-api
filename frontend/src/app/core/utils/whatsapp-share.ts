import { EventoDetalleDTO, TransaccionDTO } from '../models/cabales.models';

/**
 * Convierte centavos a formato de moneda salvadoreña ($0.00)
 */
function formatoDinero(centavos: number): string {
  const dolares = (centavos / 100).toFixed(2);
  return `$${dolares}`;
}

/**
 * Genera un mensaje estructurado y amigable para cobrar una mesa liquidada en WhatsApp.
 */
export function generarMensajeCobroWhatsApp(
  evento: EventoDetalleDTO,
  transacciones: TransaccionDTO[],
  datosBancarios?: string
): string {
  const totalDolares = formatoDinero(evento.total_gastado_centavos);
  const pendientes = transacciones.filter((t) => t.estado === 'PENDIENTE' || t.estado === 'EN_DISPUTA');

  let mensaje = `🧾 *CABALES — RESUMEN DE LA MESA*\n`;
  mensaje += `📍 *Evento:* ${evento.nombre}\n`;
  mensaje += `💰 *Total de la cuenta:* ${totalDolares}\n\n`;

  if (pendientes.length === 0) {
    mensaje += `🎉 *¡Todos cabales!* La mesa ya está 100% saldada.\n`;
  } else {
    mensaje += `📋 *TRANSFERENCIAS PENDIENTES:*\n`;
    for (const t of pendientes) {
      const monto = formatoDinero(t.monto_centavos);
      mensaje += `• *${t.deudor.nombre_visible}* ➡️ le debe *${monto}* a *${t.acreedor.nombre_visible}*\n`;
    }
  }

  if (datosBancarios && datosBancarios.trim().length > 0) {
    mensaje += `\n💳 *DATOS DE TRANSFERENCIA:*\n${datosBancarios.trim()}\n`;
  }

  const url = typeof window !== 'undefined' ? `${window.location.origin}/events/${evento.id}/settlement` : '';
  if (url) {
    mensaje += `\n📲 *Revisa tu cuenta o sube tu comprobante aquí:*\n${url}\n`;
  }

  mensaje += `\n_Generado con Cabales 🇸🇻 — Cuentas claras, amistades cabales._`;
  return mensaje;
}

/**
 * Genera un mensaje de invitación para unirse a una mesa activa.
 */
export function generarMensajeInvitacionMesa(evento: EventoDetalleDTO, urlMesa: string): string {
  let mensaje = `👋 ¡Hey! Estamos en *${evento.nombre}* con *Cabales* 🇸🇻\n\n`;
  mensaje += `Únete a la mesa para ver la cuenta en tiempo real y anotar tus consumos:\n`;
  mensaje += `👉 ${urlMesa}\n\n`;
  mensaje += `_Cuentas claras, amistades cabales._`;
  return mensaje;
}

/**
 * Abre WhatsApp con el mensaje codificado o usa el Web Share API si está en dispositivo móvil.
 */
export async function compartirTexto(titulo: string, texto: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: titulo,
        text: texto
      });
      return true;
    } catch {
      // Si el usuario canceló el share o falló, recurrir a WhatsApp Web / App
    }
  }

  const encoded = encodeURIComponent(texto);
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encoded}`;
  if (typeof window !== 'undefined') {
    window.open(whatsappUrl, '_blank');
    return true;
  }
  return false;
}

/**
 * Copia texto al portapapeles de forma segura
 */
export async function copiarTextoAlPortapapeles(texto: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Fallback
    }
  }

  // Fallback con input temporal si navigator.clipboard falla
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = texto;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ex = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ex;
    } catch {
      return false;
    }
  }
  return false;
}
