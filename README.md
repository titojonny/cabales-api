# Cabales API

Backend de Cabales: app para dividir gastos de salidas entre amigos.

## Stack

- Node.js + TypeScript (estricto)
- Express 5
- Prisma 7 con SQLite (driver adapter better-sqlite3)
- Validación con zod, tests con Vitest + Supertest

## Primeros pasos (para clonar el repo)

```bash
# 1. Instalar dependencias
npm install

# 2. Aplicar las migraciones (crea tu dev.db local)
npx prisma migrate deploy

# 3. Generar el cliente Prisma
npx prisma generate

# 4. Levantar el servidor en http://localhost:3000
npm run dev
```

> Nota: no necesitas tocar `.env`. Si no existe, `DATABASE_URL` toma el valor por defecto `file:./dev.db`.

## Reglas de negocio (¡No romper!)

- **Dinero en centavos:** todos los montos se guardan como `Int` en centavos (`total_gastado_centavos`, `monto_consumido_centavos`, `monto_pagado_centavos`, `monto_centavos`). Nunca usar `Float` para dinero.
- **Reparto exacto:** la suma de las partes siempre debe cuadrar con el total. Usa `repartirCentavosExactos()` / `repartirCentavosSobrantes()` en `src/utils/money.ts` y `src/utils/settlement.ts`.
- **Transacciones atómicas:** operaciones complejas (cerrar evento, pagos múltiples) usan `$transaction` de Prisma.
- **Evento CERRADO = bloqueado:** prohibido agregar/editar/eliminar consumos o participantes.
- **Envelope unificado:** toda respuesta es `{ success, message?, data?, error? }`. Errores en español.

## Endpoints actuales

| Método | Ruta                                  | Descripción                                   | Body                                   |
|--------|---------------------------------------|-----------------------------------------------|----------------------------------------|
| GET    | `/api/health`                         | Health check del servidor                     | -                                      |
| GET    | `/api/test-db`                        | Prueba de conexión con la base de datos       | -                                      |
| POST   | `/api/users`                          | Crear un usuario                              | `{ "nombre": "...", "email": "..." }`  |
| GET    | `/api/users/:id/events`               | Dashboard: eventos como creador o invitado    | -                                      |
| POST   | `/api/events`                         | Crear un evento anclado a un creador          | `{ "nombre": "...", "creador_id": "uuid" }` |
| GET    | `/api/events/:id`                     | Detalle del evento con sus comensales         | -                                      |
| POST   | `/api/events/:id/participants`        | Sentar a un comensal (usuario o fantasma)     | `{ "usuario_id": "uuid" }` o `{ "nombre_invitado": "..." }` (nunca ambos) |
| POST   | `/api/events/:id/consumptions`        | Registrar consumo individual o compartido     | `{ "monto_centavos": 10000, "participante_ids": ["uuid"] }` |
| POST   | `/api/events/:id/payments`            | Registrar pago de un comensal (acumula)       | `{ "participante_id": "uuid", "monto_centavos": 5000 }` |
| POST   | `/api/events/:id/close`               | Liquidar la mesa (flujo mínimo de efectivo)   | - |

> **Dinero:** todos los montos viajan en **centavos enteros** (`monto_centavos`). Nunca decimales de dólar en la API.

## Flujo de prueba

1. `POST /api/users` con `{ "nombre": "Jonathan", "email": "jonathan@ufg.edu.sv" }` → devuelve el `id` (UUID).
2. `POST /api/events` con `{ "nombre": "Cena por el proyecto", "creador_id": "<id del paso 1>" }` → evento creado.
3. `POST /api/events/:id/participants` + `POST /api/events/:id/consumptions` + `POST /api/events/:id/payments` → arma la mesa sin tocar SQL.
4. `POST /api/events/:id/close` → liquida con el mínimo de transferencias.

## Tests

```bash
npm test          # vitest: utilidades de dinero + flujo de la API
npm run typecheck # tsc --noEmit
```

## Estructura del proyecto

```
src/
  index.ts              # Arranque del servidor
  app.ts                # Configuración de Express (middleware + rutas)
  config/prisma.ts      # Instancia única de PrismaClient
  routes/               # Definición de endpoints (health, usuarios, eventos)
  controllers/          # Lógica de negocio (participantes, consumos, pagos, cierre)
  middlewares/          # errorHandler + validateBody (zod)
  validators/           # Schemas de zod para el req.body
  utils/money.ts        # Utilidades de dinero en centavos (reparto exacto)
  utils/settlement.ts   # Balances y flujo mínimo de efectivo
tests/                  # Tests con Vitest + Supertest
```

## Ramas

- `dev`: rama principal de desarrollo. Siempre se trabaja sobre ella.