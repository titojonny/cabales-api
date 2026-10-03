import { z } from 'zod';
import { ExternalProviderError } from './errors.js';
import { outboundFetch } from './http-client.js';
import { parseTicketText } from '../modules/ocr/ticket-parser.js';

/** Propuesta editable extraída de un comprobante; nunca se aplica sin confirmación humana. */
export const ocrProposalSchema = z
  .object({
    merchant: z.string().trim().max(160).nullable().default(null),
    totalCents: z.number().int().positive().max(2_147_483_647).nullable().default(null),
    subtotalCents: z.number().int().nonnegative().max(2_147_483_647).nullable().default(null),
    taxCents: z.number().int().nonnegative().max(2_147_483_647).nullable().default(null),
    tipCents: z.number().int().nonnegative().max(2_147_483_647).nullable().default(null),
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
          confidence: z.number().min(0).max(1).nullable().default(null),
        }),
      )
      .max(200)
      .default([]),
    confidence: z.number().min(0).max(1).nullable().default(null),
    confidenceByField: z
      .object({
        merchant: z.number().min(0).max(1).nullable(),
        occurredAt: z.number().min(0).max(1).nullable(),
        currency: z.number().min(0).max(1).nullable(),
        totalCents: z.number().min(0).max(1).nullable(),
        subtotalCents: z.number().min(0).max(1).nullable(),
        taxCents: z.number().min(0).max(1).nullable(),
        tipCents: z.number().min(0).max(1).nullable(),
        items: z.number().min(0).max(1).nullable(),
      })
      .strict()
      .nullable()
      .default(null),
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

export interface TesseractRecognition {
  data: { text: string; confidence?: number };
}

export interface TesseractWorker {
  recognize(image: Buffer): Promise<TesseractRecognition>;
  terminate(): Promise<unknown>;
}

export type TesseractWorkerFactory = (options: {
  langs: string;
  langPath?: string;
}) => Promise<TesseractWorker>;

/** OCR local real con Tesseract.js; el worker es inyectable para pruebas sin modelos. */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract';

  constructor(
    private readonly options: {
      langs: string;
      langPath?: string;
      workerFactory?: TesseractWorkerFactory;
    },
  ) {}

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrProposal> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) {
      if (input.mimeType === 'application/pdf')
        throw new ExternalProviderError('ocr', 'OCR_TESSERACT_PDF_UNSUPPORTED', false);
      throw new ExternalProviderError('ocr', 'OCR_TESSERACT_MEDIA_UNSUPPORTED', false);
    }
    const factory = this.options.workerFactory ?? defaultTesseractWorkerFactory;
    const worker = await factory({
      langs: this.options.langs,
      ...(this.options.langPath ? { langPath: this.options.langPath } : {}),
    });
    try {
      const result = await worker.recognize(input.bytes);
      return ocrProposalSchema.parse(parseTicketText(result.data.text, result.data.confidence));
    } finally {
      await worker.terminate();
    }
  }
}

async function defaultTesseractWorkerFactory(options: {
  langs: string;
  langPath?: string;
}): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(
    options.langs,
    1,
    options.langPath ? { langPath: options.langPath } : undefined,
  );
  return worker as unknown as TesseractWorker;
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
