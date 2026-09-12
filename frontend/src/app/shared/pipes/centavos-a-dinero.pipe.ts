import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe standalone para transformar centavos enteros (Int) a formato de moneda (ej. 1050 -> $10.50).
 */
@Pipe({
  name: 'centavosADinero',
  standalone: true
})
export class CentavosADineroPipe implements PipeTransform {
  transform(
    centavos: number | null | undefined,
    locale = 'es-SV',
    currency = 'USD'
  ): string {
    if (centavos === null || centavos === undefined || isNaN(centavos)) {
      return '$0.00';
    }

    const dolares = centavos / 100;

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(dolares);
  }
}
