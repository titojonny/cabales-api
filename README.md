# Cabales API

Backend de Cabales: app para dividir gastos de salidas entre amigos.

## Stack

- Node.js + TypeScript
- Express 5
- Prisma 7 con SQLite (driver adapter better-sqlite3)

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

## Endpoints actuales

| Método | Ruta          | Descripción                                   | Body                          |
|--------|---------------|-----------------------------------------------|-------------------------------|
| GET    | `/api/health` | Health check del servidor                     | -                             |
| GET    | `/api/test-db`| Prueba de conexión con la base de datos       | -                             |
| POST   | `/api/users`  | Crear un usuario                              | `{ "nombre": "...", "email": "..." }` |
| POST   | `/api/events` | Crear un evento anclado a un usuario creador  | `{ "nombre": "...", "creador_id": "uuid" }` |

## Flujo de prueba

1. `POST /api/users` con `{ "nombre": "Jonathan", "email": "jonathan@ufg.edu.sv" }` → devuelve el `id` (UUID).
2. `POST /api/events` con `{ "nombre": "Cena por el proyecto", "creador_id": "<id del paso 1>" }` → evento creado.

## Ramas

- `dev`: rama principal de desarrollo. Siempre se trabaja sobre ella.