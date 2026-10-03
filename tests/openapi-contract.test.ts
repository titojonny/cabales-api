import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Prefijos con que app.ts monta cada router de módulo. */
const MOUNTS: Record<string, string> = {
  auth: '/auth',
  groups: '/groups',
  events: '/groups/:groupId/events',
  expenses: '/groups/:groupId/expenses',
  settlements: '/groups/:groupId/settlements',
  funds: '/groups/:groupId/funds',
  budgets: '/groups/:groupId/budgets',
  privacy: '/privacy',
  documents: '/documents',
  ocr: '/ocr',
  cabudas: '/cabudas',
  statistics: '/statistics',
  incomes: '/incomes',
  notifications: '/notifications',
  achievements: '/achievements',
};
const ROUTE = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g;
const LOOP = /for \(const path of \[([^\]]+)\]\)\s*\{\s*router\.(get|post|put|patch|delete)\(path/g;

function normalize(route: string) {
  const clean = route.replace(/\/$/, '') || '/';
  return clean.replace(/:([A-Za-z]+)/g, '{$1}');
}

function implementedRoutes() {
  const routes = new Set<string>();
  const modules = path.resolve('src/modules');
  for (const dir of readdirSync(modules)) {
    const file = path.join(modules, dir, `${dir}.router.ts`);
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const prefix = MOUNTS[dir];
    expect(prefix, `Router sin prefijo conocido: ${dir}`).toBeDefined();
    const storageStart = source.indexOf('export function createLocalStorageRouter');
    for (const match of source.matchAll(ROUTE)) {
      const base = storageStart >= 0 && match.index > storageStart ? '/storage' : prefix;
      routes.add(`${match[1]!.toUpperCase()} ${normalize(`/api/v1${base}${match[2]}`)}`);
    }
    for (const match of source.matchAll(LOOP)) {
      for (const literal of match[1]!.matchAll(/'([^']+)'/g)) {
        routes.add(`${match[2]!.toUpperCase()} ${normalize(`/api/v1${prefix}${literal[1]}`)}`);
      }
    }
  }
  return routes;
}

function documentedRoutes() {
  const routes = new Set<string>();
  let current: string | null = null;
  for (const line of readFileSync(path.resolve('docs/openapi.yaml'), 'utf8').split('\n')) {
    const pathMatch = /^ {2}(\/[^:]*):\s*$/.exec(line);
    if (pathMatch) {
      current = pathMatch[1]!;
      continue;
    }
    if (/^\S/.test(line)) current = null;
    const method = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (current?.startsWith('/api/v1') && method)
      routes.add(`${method[1]!.toUpperCase()} ${current}`);
  }
  return routes;
}

describe('Contrato OpenAPI', () => {
  const implemented = implementedRoutes();
  const documented = documentedRoutes();

  it('detecta las rutas de ambos lados', () => {
    expect(implemented.size).toBeGreaterThan(80);
    expect(documented.size).toBeGreaterThan(80);
  });

  it('documenta cada ruta implementada', () => {
    expect([...implemented].filter((route) => !documented.has(route)).sort()).toEqual([]);
  });

  it('no documenta rutas inexistentes', () => {
    expect([...documented].filter((route) => !implemented.has(route)).sort()).toEqual([]);
  });

  it('cada operación tiene operationId único', () => {
    const ids = [
      ...readFileSync(path.resolve('docs/openapi.yaml'), 'utf8').matchAll(/operationId: (\w+)/g),
    ].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
