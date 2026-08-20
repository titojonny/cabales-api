// Utilidades de dinero: TODO se maneja en CENTAVOS (Int) para evitar
// errores de precisión de punto flotante. Regla de negocio #1 de Cabales:
// la suma de las partes SIEMPRE debe cuadrar exactamente con el total.

// Convierte dólares (float) a centavos (Int) con redondeo correcto
export function dolaresACentavos(dolares: number): number {
  return Math.round((dolares + Number.EPSILON) * 100);
}

// Convierte centavos (Int) a dólares (float) solo para mostrar al usuario
export function centavosADolares(centavos: number): number {
  return centavos / 100;
}

// Reparte la cuenta en partes que cuadren EXACTAMENTE con el total en centavos.
// Si sobra un centavo, se asigna a los primeros participantes; si falta,
// se descuenta. Devuelve las partes en centavos.
export function repartirCentavosSobrantes(montosDolares: number[], totalDolares: number): number[] {
  if (montosDolares.length === 0) {
    return [];
  }

  const totalCentavos = dolaresACentavos(totalDolares);
  const partes = montosDolares.map(dolaresACentavos);
  let sobrante = totalCentavos - partes.reduce((a, b) => a + b, 0);
  let indice = 0;

  while (sobrante !== 0) {
    const ajuste = Math.sign(sobrante);
    const posicion = indice % partes.length;
    partes[posicion] = (partes[posicion] ?? 0) + ajuste;
    sobrante -= ajuste;
    indice += 1;
  }

  return partes;
}