import { z } from 'zod';
import { ExternalProviderError } from './errors.js';
import { outboundFetch } from './http-client.js';

/** Propuesta editable extraída de un comprobante; nunca se aplica sin confirmación humana. */
export const ocrProposalSchema = z
  .object({
    merchant: z.string().trim().max(160).nullable().default(null),
    totalCents: z.number().int().positive().max(2_147_483_647).nullable().default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          amountCents: z.number().int().positive().max(2_147_483_647),
          quantity: z.number().int().positive().max(10_000).default(1),
        }),
      )
      .max(200)
      .default([]),
    confidence: z.number().min(0).max(1).nullable().default(null),
  })
  .strip();

export type OcrProposal = z.infer<typeof ocrProposalSchema>;

/** Puerto OCR; las implementaciones deben fallar explícitamente con códigos estables. */
export interface OcrProvider {
  readonly name: string;
  extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrProposal>;
}

/** Doble local honesto: no inventa datos y marca el trabajo como fallido. */
export class DisabledOcrProvider implements OcrProvider {
  readonly name = 'disabled';
  async extract(): Promise<OcrProposal> {
    throw new ExternalProviderError('ocr', 'OCR_PROVIDER_DISABLED', false);
  }
}

/**
 * Adaptador determinista solo para desarrollo/pruebas. Nunca interpreta documentos reales:
 * devuelve una propuesta claramente marcada como local para ejercitar todo el flujo humano.
 */
export class LocalOcrProvider implements OcrProvider {
  readonly name = 'local';

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrProposal> {
    const totalCents = Math.max(1, Math.min(input.bytes.length * 10, 2_147_483_647));
    return ocrProposalSchema.parse({
      merchant: 'Proveedor local (solo desarrollo)',
      totalCents,
      currency: 'USD',
      occurredAt: null,
      items: [],
      confidence: 0,
    });
  }
}

/** Servicio OCR externo que recibe el binario y devuelve JSON validado por ocrProposalSchema. */
export class HttpOcrProvider implements OcrProvider {
  readonly name = 'http';
  constructor(
    private readonly options: {
      url: string;
      apiKey?: string;
      timeoutMs: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrProposal> {
    const response = await outboundFetch(
      this.options.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': input.mimeType,
          Accept: 'application/json',
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: new Uint8Array(input.bytes),
      },
      {
        provider: 'ocr',
        timeoutMs: this.options.timeoutMs,
        retries: 1,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      },
    );
    const parsed = ocrProposalSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ExternalProviderError('ocr', 'INVALID_RESPONSE', false);
    return parsed.data;
  }
}
