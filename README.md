# Cabales API

API REST de Cabales para registrar grupos y eventos, dividir gastos manuales en centavos y producir liquidaciones verificables. Es un monolito modular en Express, TypeScript, Prisma 7 y PostgreSQL.

## Arquitectura

La separación mínima es deliberada:

- `src/config`: validación de entorno y logger seguro.
- `src/database`: creación del adaptador PostgreSQL y Prisma Client.
- `src/http`: composición Express, seguridad transversal, sobre de respuesta y errores.
- `src/shared`: errores, criptografía, validación y dominio puro de dinero/liquidación.
- `src/modules`: módulos `auth`, `groups`, `events`, `expenses` y `settlements`.
- Cada módulo separa schema Zod, servicio de negocio, repositorio Prisma y router HTTP.
- `prisma/schema.prisma`: modelo completo de persistencia. No hay migraciones en este repositorio.
- `docs/openapi.yaml`: contrato HTTP de la versión 1.

El dominio de dinero y liquidación no importa Express ni Prisma. Los repositorios no deciden RBAC ni repartos.

## Requisitos

- Node.js 20.19 o superior.
- npm.
- PostgreSQL 15 o superior. `docker-compose.yml` ofrece PostgreSQL 17 para desarrollo.

## Inicio local

1. Crear la configuración local a partir de `.env.example` y cambiar cualquier credencial compartida.
2. Iniciar PostgreSQL con `docker compose up -d postgres` o usar una instancia aislada propia.
3. Instalar exactamente el lockfile con `npm ci`.
4. Aplicar el esquema sin migraciones con `npm run db:push`.
5. Insertar catálogos públicos con `npm run db:seed`.
6. Iniciar desarrollo con `npm run dev`.

`db:reset` destruye y reconstruye la base indicada por `DATABASE_URL`; se debe usar únicamente contra una base desechable confirmada.

## Variables

- `NODE_ENV`: `development`, `test` o `production`; activa cookies `Secure` en producción.
- `PORT`: puerto HTTP, por defecto `3000`.
- `DATABASE_URL`: URL `postgresql://` obligatoria.
- `CORS_ORIGINS`: allowlist exacta separada por comas; nunca se usa comodín con credenciales.
- `SESSION_TTL_HOURS`: vigencia de la sesión, por defecto 168 horas.
- `COOKIE_NAME`: nombre de la cookie HttpOnly.
- `RATE_LIMIT_MAX`: máximo global por IP cada 15 minutos.
- `AUTH_RATE_LIMIT_MAX`: máximo más estricto para autenticación cada 15 minutos.
- `TRUST_PROXY`: número exacto de proxies confiables delante de Express; `0` por defecto.
- `LOG_LEVEL`: nivel de Pino; tokens, cookies, contraseñas y autorización se redactan.

La configuración se valida con Zod antes de abrir el puerto o consultar la base.

## Scripts

- `npm run dev`: servidor con recarga.
- `npm install` y `npm ci`: ejecutan `prisma generate` como `postinstall`, sin conectarse a la base.
- `npm run build`: compila fuente a `dist`.
- `npm start`: ejecuta el build.
- `npm run lint`: analiza fuente y pruebas.
- `npm run typecheck`: comprueba fuente, configuración y pruebas.
- `npm test`: ejecuta Vitest sin requerir PostgreSQL.
- `npm run format` y `npm run format:check`: aplica o verifica Prettier.
- `npm run db:generate`: genera Prisma Client.
- `npm run db:push`: sincroniza el schema con PostgreSQL sin crear migraciones.
- `npm run db:seed`: carga logros idempotentes, sin usuarios ni contraseñas por defecto.
- `npm run db:reset`: `db push --force-reset` seguido de seed; es destructivo.

## Contrato HTTP

Toda respuesta usa el sobre `{ "success": true, "data": ..., "meta": ... }` o `{ "success": false, "error": { "code", "message", "requestId" } }`. `X-Request-Id` válido se propaga; de lo contrario se genera un UUID. El detalle completo de cuerpos y códigos está en `docs/openapi.yaml`.

Endpoints públicos:

- `GET /health`
- `GET /ready`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`

Endpoints autenticados:

- `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`
- `POST|GET /api/v1/groups`
- `GET|PATCH|DELETE /api/v1/groups/:groupId`
- `POST /api/v1/groups/:groupId/invitations`
- `POST /api/v1/groups/invitations/accept`
- `POST|GET /api/v1/groups/:groupId/events`
- `GET /api/v1/groups/:groupId/events/:eventId`
- `POST|GET /api/v1/groups/:groupId/expenses`
- `GET /api/v1/groups/:groupId/expenses/:expenseId`
- `POST|GET /api/v1/groups/:groupId/settlements`
- `GET /api/v1/groups/:groupId/settlements/:settlementId`
- `PATCH /api/v1/groups/:groupId/settlements/:settlementId/transfers/:transferId/paid`

Crear gasto y liquidación exige `Idempotency-Key`. Una respuesta se reproduce durante 24 horas; después, la misma llave puede reclamarse de nuevo de forma atómica. Toda mutación autenticada exige que `X-CSRF-Token` coincida con la cookie CSRF y con el hash ligado a la sesión. `GET /auth/me` devuelve ese token solo después de validar la cookie contra la sesión, lo que permite recuperarlo tras una recarga en otro host autorizado.

## Dinero y cierre

- Todo monto se representa como `Int` de centavos y moneda ISO de tres letras.
- La moneda del grupo no puede cambiar después del primer gasto.
- `EQUAL` distribuye el residuo de un centavo de forma determinista según el orden validado.
- `EXACT` exige `shareCents` para cada participante.
- La suma de pagadores y la suma de partes deben ser exactamente `totalCents`.
- Si hay ítems, estos suman el total, cada asignación cuadra con su ítem y el agregado por participante cuadra con su parte.
- Los participantes de gasto son referencias a `EventParticipant`, que puede representar un miembro o un invitado; nunca se acepta un actor externo al evento.
- Una liquidación se calcula desde gastos, no desde contadores duplicados. La suma neta debe ser cero.
- Existe como máximo una liquidación por evento. El cierre y sus transferencias son atómicos y cierran el evento.
- El pago escribe una marca de versión en la liquidación dentro de una transacción serializable y ejecuta una actualización final idempotente; dos últimas transferencias concurrentes convergen a completada.

Prisma no genera restricciones `CHECK`. Los servicios MVP verifican positividad, sumas, moneda, pertenencia y transiciones implementadas. Los modelos futuros todavía sin servicio solo documentan la intención y deberán incorporar validación antes de exponerse. Una implantación con migraciones gestionadas podría añadir `CHECK` como defensa adicional, pero este proyecto usa exclusivamente `db push` por requisito explícito.

## Seguridad

- Contraseñas con Argon2id y salt administrado por la biblioteca.
- Tokens de sesión e invitación aleatorios; PostgreSQL conserva solo SHA-256 de los tokens.
- Sesiones expirables y revocables en cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Token CSRF por sesión en cabecera y cookie separada, comparado en tiempo constante.
- Las respuestas de autenticación y rutas privadas usan `Cache-Control: private, no-store`; health y readiness usan `no-store` para evitar estados obsoletos.
- RBAC `OWNER`, `ADMIN`, `MEMBER`; el actor siempre se deriva de la sesión.
- Helmet, CORS allowlist, JSON máximo de 32 KB, rate limit global y límite estricto solo en login/register.
- Consultas parametrizadas mediante Prisma, errores centralizados y logs JSON sin secretos.
- Gastos, cierres, pagos y cambios parentales críticos usan transacciones `Serializable` con hasta tres intentos ante `P2034`.
- El cambio de moneda y borrado bloquean la fila del grupo; la creación de gasto toma un bloqueo compartido. Las FK hacen que creaciones concurrentes esperen o fallen de forma segura.
- El rate limit en memoria sirve a una instancia. Producción con varias réplicas requiere un store compartido. `TRUST_PROXY` debe coincidir exactamente con los saltos controlados; un valor excesivo permite falsificar la IP cliente.

## Modelo

El schema incluye `User`, `Account`, `Session`, `Group`, `GroupMember`, `GroupInvitation`, `Event`, `EventParticipant`, `EventLink`, `Expense`, `ExpenseParticipant`, `ExpensePayer`, `ExpenseItem`, `ExpenseItemAllocation`, `Receipt`, `OcrJob`, `Settlement`, `SettlementTransfer`, `TransferStatusHistory`, `Fund`, `FundMember`, `FundMovement`, `Category`, `Tag`, `ExpenseTag`, `Budget`, `RecurringExpense`, `Document`, `DocumentAccessGrant`, `DocumentAccessLog`, `PushSubscription`, `Notification`, `Achievement`, `UserAchievement`, `IdempotencyKey` y `AuditLog`.

Balances, saldos de fondos, consumo de presupuestos y estadísticas no se almacenan: se derivan de movimientos y gastos.

## Verificación

Las pruebas unitarias cubren reparto exacto, entradas monetarias inválidas, determinismo, balances, reintentos acotados, expiración idempotente, URLs, DTO estrictos y pago repetido. Supertest cubre health, readiness fallido, sobre 404, límites auth, cache, cookies y recuperación CSRF sin conectarse a PostgreSQL. No se ejecutan pruebas destructivas ni integración contra una base del usuario.

Comandos de verificación recomendados:

```sh
npm ci
npm run db:generate
npx prisma format
npx prisma validate
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

Para `prisma validate` basta una URL PostgreSQL sintácticamente válida; no abre una conexión.

## Límites actuales

- El MVP implementa API para autenticación, grupos, invitaciones, eventos, gastos manuales y liquidaciones. Fondos, OCR, documentos, presupuestos, recurrencia, notificaciones y logros están modelados pero aún no tienen endpoints.
- No hay edición ni borrado de gastos financieros; al cerrar el evento quedan inmutables por diseño.
- Los invitados no tienen identidad autenticada y una transferencia suya debe marcarla un OWNER o ADMIN.
- No se envían correos: el token de invitación se devuelve una sola vez al creador para integrarlo después con un proveedor.
- El claim de invitación es un `updateMany` condicional atómico antes del `upsert` de membresía.
- Los bloqueos `FOR UPDATE`/`FOR SHARE`, carreras de FK y colisiones únicas se implementan para PostgreSQL, pero requieren una prueba de concurrencia contra una base aislada que no se ejecutó en esta tarea.
- `DOCUMENTACION.md` incluye cada archivo mantenido y `package-lock.json`; excluye `node_modules`, `dist`, cobertura y Prisma Client generado, que no se versionan ni se mantienen manualmente.
- `npm audit` puede señalar `deepmerge-ts` transitivo del CLI Prisma 7. La corrección automática propuesta baja a Prisma 6 y no se aplica porque contradice el requisito; el paquete afecta tooling, no el proceso HTTP de producción.

## Principios aplicados

Se aplican SRP y separación de validación, negocio y persistencia; zero trust en body, parámetros, cookies y cabeceras; mínimo privilegio RBAC; atomicidad y aislamiento serializable; request/correlation ID; fallos seguros y mensajes controlados; health/readiness separados; logs sin secretos; y algoritmos puros, deterministas y verificables para dinero y liquidación.
