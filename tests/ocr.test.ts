import { describe, expect, it, vi } from 'vitest';
import { TesseractOcrProvider } from '../src/infrastructure/ocr.js';
import { parseTicketText } from '../src/modules/ocr/ticket-parser.js';

describe('parser de tickets', () => {
  it('extrae un ticket español con importes europeos y conserva campos detectados', () => {
    const proposal = parseTicketText(`
      Supermercado La Ceiba
      Fecha: 12/08/2026
      2 x Café 4,00
      Pan 1,20
      SUBTOTAL 5,20
      IVA 0,68
      PROPINA 0,50
      TOTAL 6,38 USD
    `);
    expect(proposal).toMatchObject({
      merchant: 'Supermercado La Ceiba',
      occurredAt: '2026-08-12T00:00:00.000Z',
      currency: 'USD',
      subtotalCents: 520,
      taxCents: 68,
      tipCents: 50,
      totalCents: 638,
    });
    expect(proposal.items).toEqual([
      expect.objectContaining({ name: 'Café', quantity: 2, amountCents: 400 }),
      expect.objectContaining({ name: 'Pan', quantity: 1, amountCents: 120 }),
    ]);
    expect(proposal.confidenceByField?.totalCents).toBeGreaterThan(0);
  });

  it('extrae un ticket inglés con separador de miles y no inventa lo ausente', () => {
    const proposal = parseTicketText(`
      Corner Market
      Date 2026-03-04
      USD
      Apples 1 2.50
      Coffee 3.25
      Subtotal 5.75
      Tax 0.58
      Total 6.33
    `);
    expect(proposal).toMatchObject({
      merchant: 'Corner Market',
      occurredAt: '2026-03-04T00:00:00.000Z',
      currency: 'USD',
      subtotalCents: 575,
      taxCents: 58,
      totalCents: 633,
      tipCents: null,
    });
    expect(proposal.items).toEqual([
      expect.objectContaining({ name: 'Apples', quantity: 1, amountCents: 250 }),
      expect.objectContaining({ name: 'Coffee', quantity: 1, amountCents: 325 }),
    ]);
  });

  it('deja null cuando el texto no contiene datos reconocibles', () => {
    expect(parseTicketText('Gracias por su visita')).toMatchObject({
      merchant: 'Gracias por su visita',
      totalCents: null,
      subtotalCents: null,
      taxCents: null,
      tipCents: null,
      currency: null,
      occurredAt: null,
      items: [],
      confidence: expect.any(Number),
    });
  });
});

describe('TesseractOcrProvider', () => {
  it('usa un motor simulado sin descargar modelos y termina el worker', async () => {
    const terminate = vi.fn(async () => undefined);
    const provider = new TesseractOcrProvider({
      langs: 'spa+eng',
      workerFactory: vi.fn(async () => ({
        recognize: vi.fn(async () => ({ data: { text: 'Shop\nTOTAL 10.00 USD', confidence: 91 } })),
        terminate,
      })),
    });
    await expect(
      provider.extract({ bytes: Buffer.from('image'), mimeType: 'image/png' }),
    ).resolves.toMatchObject({
      merchant: 'Shop',
      totalCents: 1000,
      currency: 'USD',
      confidence: 0.91,
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('rechaza PDF con un error de formato claro', async () => {
    const provider = new TesseractOcrProvider({ langs: 'spa+eng', workerFactory: vi.fn() });
    await expect(
      provider.extract({ bytes: Buffer.from('pdf'), mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({
      code: 'OCR_TESSERACT_PDF_UNSUPPORTED',
    });
  });
});
