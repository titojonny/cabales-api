import type { StatisticsCsvSummary } from './statistics.service.js';

function printable(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[()\\]/g, (character) => `\\${character}`)
    .slice(0, 180);
}

function money(cents: number, currency: string | null): string {
  return `${currency ?? ''} ${(cents / 100).toFixed(2)}`.trim();
}

/** PDF mínimo de texto, generado en Node sin navegador ni motor de renderizado. */
export function buildStatisticsPdf(summary: StatisticsCsvSummary): Buffer {
  const lines = [
    'Cabales - Informe mensual de estadisticas',
    `Periodo: ${summary.incomeSummary?.from.toISOString().slice(0, 10) ?? summary.projection?.month ?? ''} a ${summary.incomeSummary?.to.toISOString().slice(0, 10) ?? ''}`,
    `Total de gastos: ${money(summary.totals.spentCents, summary.currency)} (${summary.totals.expenseCount} gastos)`,
    `Tu parte: ${money(summary.totals.myShareCents, summary.currency)} | Pagado: ${money(summary.totals.myPaidCents, summary.currency)}`,
    '',
    'Comparacion con el periodo anterior equivalente',
    summary.comparison
      ? `Total: ${money(summary.comparison.total.currentCents, summary.currency)} vs ${money(summary.comparison.total.previousCents, summary.currency)} | Variacion: ${money(summary.comparison.total.absoluteCents, summary.currency)} (${summary.comparison.total.percentage ?? 'sin base'}%)`
      : 'No disponible',
    ...(summary.comparison?.byCategory
      .slice(0, 12)
      .map(
        (item) =>
          `Categoria ${item.name}: ${money(item.absoluteCents, summary.currency)} (${item.percentage ?? 'sin base'}%)`,
      ) ?? []),
    '',
    'Proyeccion (estimacion, no dato real)',
    ...(summary.projection
      ? [
          `Mes ${summary.projection.month}: ${money(summary.projection.currentMonthSpentCents, summary.currency)} acumulado`,
          `Ritmo diario: ${money(summary.projection.dailyRateCents, summary.currency)} | Restante estimado: ${money(summary.projection.remainingProjectionCents, summary.currency)}`,
          `Recurrentes pendientes: ${money(summary.projection.recurrentPendingCents, summary.currency)}`,
        ]
      : ['No disponible']),
    '',
    'Ingresos y gastos',
    ...(summary.monthlyIncomeSummary
      ? [
          `Ingresos del mes: ${money(summary.monthlyIncomeSummary.incomeCents, summary.currency)}`,
          `Gastos del mes: ${money(summary.monthlyIncomeSummary.expenseCents, summary.currency)}`,
          `Saldo: ${money(summary.monthlyIncomeSummary.balanceCents, summary.currency)}`,
        ]
      : ['No disponible']),
    '',
    'Fondos',
    ...(summary.funds
      ?.slice(0, 20)
      .map(
        (fund) =>
          `${fund.name}: saldo ${money(fund.balanceCents, fund.currency)} (${fund.movementCount} movimientos)`,
      ) ?? ['Sin fondos visibles']),
    '',
    'Nota: las cifras se calcularon en el servidor con los datos autorizados para tu cuenta.',
  ];
  const content = [
    'BT',
    '/F1 10 Tf',
    '50 790 Td',
    ...lines.map(
      (line, index) =>
        `${index === 0 ? '/F1 14 Tf' : '/F1 10 Tf'} (${printable(line)}) Tj 0 -16 Td`,
    ),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(''), 'binary'));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'binary');
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(chunks.join(''), 'binary');
}
