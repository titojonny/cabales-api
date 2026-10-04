import type { OcrProposal } from '../../infrastructure/ocr.js';

const MONEY_PATTERN = /(?<![\w])(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?(?![\w])/g;
const DATE_PATTERN = /\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})\b/;
const SUMMARY_PATTERN =
  /^(?:total(?:\s+a\s+pagar)?|grand\s+total|amount\s+due|subtotal|sub\s*total|neto|base\s+imponible|iva|vat|tax|impuesto|sales\s+tax|propina|tip|gratuity|service\s+charge|cambio|change|pago|payment|efectivo|cash|tarjeta|card)\b/i;
const KNOWN_CURRENCIES = new Set([
  'USD',
  'EUR',
  'GBP',
  'MXN',
  'GTQ',
  'SVC',
  'HNL',
  'NIO',
  'CRC',
  'COP',
  'ARS',
  'CLP',
  'PEN',
  'BRL',
  'CAD',
  'AUD',
]);

type ConfidenceField =
  | 'merchant'
  | 'occurredAt'
  | 'currency'
  | 'totalCents'
  | 'subtotalCents'
  | 'taxCents'
  | 'tipCents'
  | 'items';

const emptyConfidence = (): Record<ConfidenceField, number | null> => ({
  merchant: null,
  occurredAt: null,
  currency: null,
  totalCents: null,
  subtotalCents: null,
  taxCents: null,
  tipCents: null,
  items: null,
});

function normalizeLine(line: string): string {
  return line.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function withoutAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('en');
}

function parseAmount(value: string, allowZero = false): number | null {
  let normalized = value.replace(/[^0-9,.-]/g, '');
  if (!normalized || normalized.includes('-')) return null;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = normalized.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.';
    const fraction = normalized.length - normalized.lastIndexOf(separator) - 1;
    if (fraction === 1 || fraction === 2) normalized = normalized.replace(separator, '.');
    else normalized = normalized.replaceAll(separator, '');
  }
  const amount = Number(normalized);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!allowZero && amount === 0) ||
    amount > 21_474_836.47
  )
    return null;
  return Math.round(amount * 100);
}

function amountsIn(line: string): Array<{ value: number; index: number; raw: string }> {
  return [...line.matchAll(MONEY_PATTERN)].flatMap((match) => {
    const raw = match[0] ?? '';
    const value = parseAmount(raw);
    return value === null ? [] : [{ value, index: match.index ?? 0, raw }];
  });
}

function labeledAmount(lines: string[], labels: RegExp, allowZero = false): number | null {
  for (const line of lines) {
    if (!labels.test(withoutAccents(line))) continue;
    const amounts = [...line.matchAll(MONEY_PATTERN)].flatMap((match) => {
      const raw = match[0] ?? '';
      const value = parseAmount(raw, allowZero);
      return value === null ? [] : [{ value, index: match.index ?? 0, raw }];
    });
    const amount = amounts.at(-1)?.value;
    if (amount !== undefined) return amount;
  }
  return null;
}

function parseDate(line: string): string | null {
  const match = line.match(DATE_PATTERN);
  if (!match) return null;
  const [, first, second, third] = match;
  let year: number;
  let month: number;
  let day: number;
  if (third!.length === 4) {
    year = Number(third);
    const english = /\b(date|issued|invoice)\b/i.test(line);
    if (english && Number(first) <= 12 && Number(second) <= 12) {
      month = Number(first);
      day = Number(second);
    } else {
      day = Number(first);
      month = Number(second);
    }
  } else if (first!.length === 4) {
    year = Number(first);
    month = Number(second);
    day = Number(third);
  } else {
    return null;
  }
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString();
}

function parseCurrency(lines: string[]): string | null {
  for (const line of lines) {
    const code = line.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
    if (code && KNOWN_CURRENCIES.has(code)) return code;
    if (/€/.test(line)) return 'EUR';
    if (/£/.test(line)) return 'GBP';
  }
  return null;
}

function parseItem(line: string): OcrProposal['items'][number] | null {
  const normalized = normalizeLine(line);
  if (!normalized || SUMMARY_PATTERN.test(withoutAccents(normalized))) return null;
  if (DATE_PATTERN.test(normalized)) return null;
  const amounts = amountsIn(normalized);
  const last = amounts.at(-1);
  if (!last) return null;
  let name = normalized
    .slice(0, last.index)
    .replace(/[.:-]+$/, '')
    .trim();
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(name)) return null;
  let quantity = 1;
  const leadingQuantity = name.match(/^(\d{1,4})\s*[x×]\s+(.+)$/i);
  const trailingQuantity = name.match(/^(.+?)\s+[x×]\s*(\d{1,4})$/i);
  const columnQuantity = name.match(/^(.+?)\s+(\d{1,4})$/);
  if (leadingQuantity) {
    quantity = Number(leadingQuantity[1]);
    name = leadingQuantity[2]!;
  } else if (trailingQuantity) {
    name = trailingQuantity[1]!;
    quantity = Number(trailingQuantity[2]);
  } else if (columnQuantity && !/^\d/.test(columnQuantity[1]!)) {
    name = columnQuantity[1]!;
    quantity = Number(columnQuantity[2]);
  }
  name = name.replace(/^[-*•]+\s*/, '').trim();
  if (!name || quantity < 1 || quantity > 10_000) return null;
  return { name: name.slice(0, 160), amountCents: last.value, quantity, confidence: 0.72 };
}

function parseMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 5)) {
    const normalized = normalizeLine(line);
    const upper = withoutAccents(normalized);
    if (!normalized || DATE_PATTERN.test(normalized) || amountsIn(normalized).length > 0) continue;
    if (/^(?:ticket|receipt|factura|invoice|comprobante|fecha|date|tel|telefono)\b/i.test(upper))
      continue;
    if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(normalized)) return normalized.slice(0, 160);
  }
  return null;
}

/** Parser determinista de texto OCR: los campos no reconocidos permanecen en null. */
export function parseTicketText(text: string, ocrConfidence?: number | null): OcrProposal {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const fieldConfidence = emptyConfidence();
  const merchant = parseMerchant(lines);
  if (merchant) fieldConfidence.merchant = 0.82;
  const occurredAt = lines.map(parseDate).find((value): value is string => value !== null) ?? null;
  if (occurredAt) fieldConfidence.occurredAt = 0.9;
  const currency = parseCurrency(lines);
  if (currency) fieldConfidence.currency = 0.9;
  const totalCents = labeledAmount(
    lines,
    /\b(?:TOTAL(?:\s+A\s+PAGAR)?|GRAND\s+TOTAL|AMOUNT\s+DUE)\b/,
  );
  if (totalCents !== null) fieldConfidence.totalCents = 0.95;
  const subtotalCents = labeledAmount(
    lines,
    /\b(?:SUBTOTAL|SUB\s+TOTAL|NETO|BASE\s+IMPONIBLE)\b/,
    true,
  );
  if (subtotalCents !== null) fieldConfidence.subtotalCents = 0.9;
  const taxCents = labeledAmount(lines, /\b(?:IVA|VAT|TAX|IMPUESTO|SALES\s+TAX)\b/, true);
  if (taxCents !== null) fieldConfidence.taxCents = 0.88;
  const tipCents = labeledAmount(lines, /\b(?:PROPINA|TIP|GRATUITY|SERVICE\s+CHARGE)\b/, true);
  if (tipCents !== null) fieldConfidence.tipCents = 0.88;
  const items = lines
    .map(parseItem)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (items.length > 0) fieldConfidence.items = 0.72;
  const detected = Object.values(fieldConfidence).filter((value) => value !== null).length;
  const confidence =
    ocrConfidence != null
      ? Math.max(0, Math.min(1, ocrConfidence > 1 ? ocrConfidence / 100 : ocrConfidence))
      : detected > 0
        ? Number((detected / Object.keys(fieldConfidence).length).toFixed(2))
        : null;
  return {
    merchant,
    totalCents,
    subtotalCents,
    taxCents,
    tipCents,
    currency,
    occurredAt,
    items,
    confidence,
    confidenceByField: fieldConfidence,
  };
}
