# Cabales API

## P3: eventos, RSVP y recordatorios

Los eventos admiten edición parcial (`PATCH /groups/:groupId/events/:eventId`) de nombre, descripción, inicio/fin, ubicación, Maps HTTPS, zona horaria y enlaces. La fecha final debe ser igual o posterior al inicio. La persona creadora o `OWNER`/`ADMIN` puede editar, cancelar y configurar recordatorios; eliminar solo es posible cuando no existen gastos ni liquidación y devuelve `409 EVENT_HAS_FINANCIAL_ACTIVITY` en caso contrario.

Cada miembro participante responde únicamente por sí mismo en `PUT .../rsvp` con `PENDING|GOING|MAYBE|DECLINED`. El detalle devuelve `respondedAt`, participantes agrupables por estado y `rsvpCounts`; el ID de participante nunca se acepta como identidad del actor.

`PUT .../reminders` reemplaza hasta cinco intervalos en minutos. El planificador de `src/infrastructure/scheduler.ts` ejecuta `event-reminders`, usa `SET NX` con expiración cuando Redis está activo y `pg_try_advisory_xact_lock` como fallback. `ScheduledJobRun` conserva la clave de ventana, intentos y resultado; las notificaciones usan `event.reminder` y `dedupeKey`, incluyendo un marcador archivado cuando in-app está desactivado para evitar duplicar correo o push. `SCHEDULER_ENABLED=false` lo desactiva; en desarrollo el valor por defecto es `true`. En producción debe permanecer `true` al menos en una instancia y `RATE_LIMIT_STORE=redis` comparte el lock entre instancias.

API REST de Cabales para registrar grupos y eventos, dividir gastos manuales en centavos, producir liquidaciones verificables y operar fondos, presupuestos, documentos, OCR asistido, Cabudas, estadísticas, avisos, logros y derechos de privacidad. Es un monolito modular en Express, TypeScript, Prisma 7 y PostgreSQL.

## P2: reparto porcentual e importes adicionales

Los gastos admiten `EQUAL`, `EXACT` y `PERCENT`. En `PERCENT`, cada participante envía `percentageBps` y la suma debe ser exactamente `10000`; el servicio calcula el subtotal con restos mayores. `subtotalCents` es la base y `totalCents` debe ser exactamente `subtotalCents + taxCents + tipCents`. Impuesto y propina aceptan importe (`taxCents`/`tipCents`) o porcentaje (`taxPercentBps`/`tipPercentBps`) sobre el subtotal, no ambos. Los porcentajes se redondean al centavo más cercano con mitad hacia arriba (`floor((subtotalCents * bps + 5000) / 10000)`). Cada cargo se reparte proporcionalmente al subtotal de las personas, también cuando ese subtotal proviene de ítems, usando restos mayores.

La migración `20261003130000_expense_breakdown_percent` agrega el enum `PERCENT`, los importes del gasto y el desglose por participante con default `0`, realiza un preflight y valida CHECK de no negativos y consistencia. La exportación estadística CSV añade `subtotalCents`, `taxCents` y `tipCents`.

## Arquitectura

La separación mínima es deliberada:

- `src/config`: validación de entorno y logger seguro.
- `src/database`: creación del adaptador PostgreSQL y Prisma Client.
- `src/http`: composición Express, seguridad transversal, sobre de respuesta y errores.
- `src/shared`: errores, criptografía, validación y dominio puro de dinero/liquidación.
- `src/infrastructure`: adaptadores intercambiables de correo, almacenamiento, OCR, push, límites de solicitudes (memoria/Redis), cliente HTTP saliente con timeout y reintentos, y tareas en segundo plano.
- `src/composition.ts`: contenedor que construye proveedores, servicios y la app Express; conecta avisos y logros al bus de eventos de dominio (`src/shared/events.ts`).
- `src/modules`: `auth`, `groups`, `events`, `expenses`, `settlements`, `funds`, `budgets`, `documents`, `ocr`, `cabudas`, `statistics`, `notifications`, `achievements` y `privacy` (incluye retención).
- `src/jobs/retention.ts`: job de retención ejecutable por cron (`--dry-run`, `--scheduled`).
- Cada módulo separa schema Zod, servicio de negocio, repositorio Prisma y router HTTP.
- `prisma/schema.prisma`: modelo completo de persistencia. El despliegue no modifica el esquema al arrancar; las migraciones deben aplicarse explícitamente.
- `docs/openapi.yaml`: contrato HTTP de la versión 1.

Este repositorio no contiene interfaz de usuario. El cliente React está en `cabales-app`.

El dominio de dinero y liquidación no importa Express ni Prisma. Los repositorios no deciden RBAC ni repartos.

## Requisitos

- Node.js 20.19 o superior.
- pnpm 11 o superior.
- PostgreSQL 15 o superior. `docker-compose.yml` ofrece PostgreSQL 17 y Redis 7 para desarrollo. El servicio `api` es opcional.
- Redis solo es obligatorio con `RATE_LIMIT_STORE=redis` (siempre en producción).

## Inicio local

1. Crear la configuración local a partir de `.env.example` y cambiar cualquier credencial compartida.
2. Iniciar PostgreSQL con `docker compose up -d postgres` o usar una instancia aislada propia. `docker compose up --build api` levanta Express en el puerto 3000.
3. Instalar exactamente el lockfile con `pnpm install --frozen-lockfile`.
4. Aplicar las migraciones versionadas con `pnpm db:migrate` (recomendado también en desarrollo). `pnpm db:push` solo sirve para prototipos desechables.
5. Insertar catálogos públicos con `pnpm db:seed`.
6. Iniciar desarrollo con `pnpm dev`.

`db:reset` destruye y reconstruye la base indicada por `DATABASE_URL`; se debe usar únicamente contra una base desechable confirmada.

## Bases existentes y baseline de migraciones

Las migraciones versionadas viven en `prisma/migrations`. Una base creada con `prisma db push` no tiene `_prisma_migrations`, por lo que no se debe ejecutar `migrate deploy` hasta registrar de forma controlada el estado inicial.

Para una base nueva, `pnpm db:migrate` aplica ambas migraciones. Para una base existente creada con `db push` antes de `20260926110000_initial_schema`, sigue exactamente este procedimiento desde `cabales-api`.

1. Respalda la base en formato custom. En PowerShell, `$env:DATABASE_URL` es la variable de conexión; en una shell POSIX usa `$DATABASE_URL`:

```powershell
pg_dump -Fc --file=.\cabales-pre-initial-schema.dump $env:DATABASE_URL
```

2. Confirma, antes de ejecutar el puente, que el esquema real es el subconjunto estricto de `20260926110000_initial_schema`: solo faltan `EmailVerificationToken`, `PasswordResetToken`, `PrivacyRequest`, sus dos enums, sus PK/FK/índices, y `User.emailVerifiedAt`; no hay objetos extra ni definiciones distintas. El puente no corrige drift y no debe aplicarse si esa condición no se cumple.

3. Ejecuta el puente aditivo e idempotente:

```powershell
pnpm exec prisma db execute --file prisma/baseline/pre-initial-schema-bridge.sql
```

4. Registra que la base ya coincide con la migración inicial:

```powershell
pnpm exec prisma migrate resolve --applied 20260926110000_initial_schema
```

5. Aplica la migración pendiente, que incluye la validación previa de filas y los `CHECK`:

```powershell
pnpm exec prisma migrate deploy
```

6. Comprueba el estado y que Prisma no vea drift:

```powershell
pnpm exec prisma migrate status
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

El último comando debe producir una migración vacía (sin SQL). `migrate status` debe indicar que no hay migraciones pendientes.

No ejecutes `resolve` para ocultar diferencias de esquema ni borres filas de `_prisma_migrations`. Si el puente detecta o la inspección previa revela drift, detén el procedimiento y reconcilia/restaura la base; el puente solo crea los objetos ausentes y no modifica ni borra datos.

Si necesitas volver al respaldo, detén la aplicación y restaura el archivo custom en una base objetivo aislada (o en la base original solo tras confirmar el destino):

```sh
pg_restore --clean --if-exists --dbname="$DATABASE_URL" ./cabales-pre-initial-schema.dump
```

En PowerShell, usa `pg_restore --clean --if-exists --dbname="$env:DATABASE_URL" .\cabales-pre-initial-schema.dump`. La restauración reemplaza los objetos y datos del destino por el contenido del respaldo; conserva el archivo hasta terminar la verificación.

### Recuperación si aborta `20260926180000_modules_privacy_docs_funds`

Si el preflight de esta migración aborta, Prisma marcará `P3018`. No borres datos ni fuerces la migración a ciegas: lee el mensaje completo, corrige únicamente los datos que el preflight identifica y vuelve a comprobar la consistencia. Después ejecuta, desde `cabales-api`:

```powershell
pnpm exec prisma migrate resolve --rolled-back 20260926180000_modules_privacy_docs_funds
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

`status` debe quedar sin migraciones pendientes y `diff` debe producir una migración vacía. Si el mensaje indica drift o filas que no pueden corregirse con seguridad, detén el proceso, respalda la base y reconcilia los datos manualmente; no uses `resolve` para ocultar diferencias.

## Variables

- `NODE_ENV`: `development`, `test` o `production`; activa cookies `Secure` en producción.
- `PORT`: puerto HTTP, por defecto `3000`.
- `DATABASE_URL`: URL `postgresql://` obligatoria.
- `CORS_ORIGINS`: allowlist exacta separada por comas (`http://localhost:5173` y `http://127.0.0.1:5173` por defecto); nunca se usa comodín con credenciales.
- `SESSION_TTL_HOURS`: vigencia de la sesión, por defecto 168 horas.
- `COOKIE_NAME`: nombre de la cookie HttpOnly.
- `RATE_LIMIT_STORE` (`memory`|`redis`) y `REDIS_URL`: store de límites; producción exige Redis compartido y el arranque falla sin él. Si Redis cae, los límites sensibles fallan cerrados (503) y el global deja pasar.
- `RATE_LIMIT_WINDOW_MINUTES`, `RATE_LIMIT_MAX` (global por IP), `AUTH_RATE_LIMIT_MAX` (login/registro por IP y por hash de correo), `RECOVERY_RATE_LIMIT_MAX` (verificación y recuperación por IP y correo), `INVITATION_RATE_LIMIT_MAX`, `UPLOAD_RATE_LIMIT_MAX`, `OCR_RATE_LIMIT_MAX`, `EXPENSE_RATE_LIMIT_MAX`, `PRIVACY_RATE_LIMIT_MAX`, `PUSH_SUBSCRIPTION_RATE_LIMIT_MAX` (POST/DELETE de suscripciones push por usuario) y `STATISTICS_EXPORT_RATE_LIMIT_MAX` (por usuario).
- `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS`, `SCHEDULER_LOCK_TTL_SECONDS` y `SCHEDULER_MAX_ATTEMPTS`: habilitación, frecuencia, TTL del lock y reintentos acotados del planificador. En producción no se debe desactivar el job de recordatorios.
- `APP_ORIGIN` y `PUBLIC_API_ORIGIN`: bases de enlaces de correo y de URLs firmadas.
- `EMAIL_VERIFICATION_TTL_HOURS`, `PASSWORD_RESET_TTL_MINUTES`, `INVITATION_TTL_DAYS`: vigencia de enlaces de un solo uso.
- `EMAIL_PROVIDER` (`logging`|`http`), `EMAIL_FROM`, `EMAIL_HTTP_URL`, `EMAIL_HTTP_API_KEY`: correo transaccional; `logging` no envía ni registra contenido.
- `STORAGE_PROVIDER` (`local`|`s3`), `STORAGE_LOCAL_DIR`, `STORAGE_SIGNING_SECRET` (≥32 caracteres en producción local), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `SIGNED_URL_TTL_SECONDS`, `MAX_UPLOAD_BYTES`. S3 funciona con MinIO y nunca devuelve URLs permanentes.
- `OCR_PROVIDER` (`disabled`|`local`|`http`|`tesseract`), `OCR_HTTP_URL`, `OCR_HTTP_API_KEY`, `OCR_TESSERACT_LANGS` (por defecto `spa+eng`), `OCR_TESSERACT_LANG_PATH` y `OCR_MAX_ATTEMPTS`; `tesseract` es OCR real local para imágenes y rechaza PDF, mientras `local` es determinista solo para desarrollo/pruebas y falla en producción. `PUSH_PROVIDER` (`disabled`|`webpush`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; la privada solo existe en el entorno del servidor.
- `STATISTICS_EXPORT_MAX_ROWS` y `STATISTICS_EXPORT_RATE_LIMIT_MAX`: límite de filas y solicitudes de la exportación CSV.
- `PRIVACY_EXPORT_TTL_DAYS` y `RETENTION_*_DAYS`: plazos provisionales de exportación y retención; deben confirmarse legalmente.
- `TRUST_PROXY`: número exacto de proxies confiables delante de Express; `0` por defecto.
- `LOG_LEVEL`: nivel de Pino; tokens, cookies, contraseñas y autorización se redactan.

La configuración se valida con Zod antes de abrir el puerto o consultar la base. El cliente oficial es el repositorio hermano `cabales-app` (React, Tailwind, TypeScript, Vite) y consume `/api/v1` con cookies y CSRF.

Para generar claves VAPID localmente, instala la dependencia y ejecuta `npx web-push generate-vapid-keys`; copia sus nombres de salida únicamente al gestor de secretos o al entorno del servidor. Nunca pongas `VAPID_PRIVATE_KEY`, credenciales S3, tokens ni claves generadas en Git, `.env.example`, logs o respuestas HTTP. `GET /api/v1/notifications/push-config` devuelve solo la clave pública cuando el proveedor está habilitado y `{ enabled: false, publicKey: null }` cuando está deshabilitado.

## Scripts

- `pnpm dev`: servidor con recarga.
- `pnpm install`: ejecuta `prisma generate` como `postinstall`, sin conectarse a la base.
- `pnpm build`: compila fuente a `dist`.
- `pnpm start`: ejecuta el build.
- `pnpm lint`: analiza fuente y pruebas.
- `pnpm typecheck`: comprueba fuente, configuración y pruebas.
- `pnpm test`: ejecuta Vitest. Sin variables extra no requiere PostgreSQL ni Redis; la suite de integración se omite.
- `pnpm test:integration`: con `TEST_DATABASE_URL` (base desechable cuyo nombre contenga `test`, con migraciones aplicadas) recorre el flujo completo contra PostgreSQL; con `TEST_REDIS_URL` además verifica límites compartidos entre dos instancias. La suite vacía todas las tablas de esa base.
- `pnpm job:retention` / `pnpm job:retention:prod`: ejecuta la retención (`-- --dry-run` para solo contar).
- `pnpm format` y `pnpm format:check`: aplica o verifica Prettier.
- `pnpm db:generate`: genera Prisma Client.
- `pnpm db:push`: sincroniza el schema con PostgreSQL para desarrollo; no debe usarse como paso automático de producción.
- `pnpm db:migrate`: aplica migraciones versionadas con `prisma migrate deploy`.
- `pnpm db:seed`: carga logros idempotentes, sin usuarios ni contraseñas por defecto.
- `pnpm db:reset`: `db push --force-reset` seguido de seed; es destructivo.

## Contrato HTTP

Toda respuesta usa el sobre `{ "success": true, "data": ..., "meta": ... }` o `{ "success": false, "error": { "code", "message", "requestId" } }`. `X-Request-Id` válido se propaga; de lo contrario se genera un UUID. El detalle completo de cuerpos y códigos está en `docs/openapi.yaml`.

Endpoints públicos:

- `GET /health`, `GET /ready`
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`
- `POST /api/v1/auth/email-verification/{request,resend,confirm}` y `POST /api/v1/auth/password-recovery/{request,resend,confirm}`: request/resend responden 202 idéntico exista o no la cuenta.
- `GET /api/v1/storage/local/:token`: descarga con URL firmada de corta duración.

Endpoints autenticados:

- `POST /api/v1/auth/logout`, `GET|PATCH /api/v1/auth/me`
- `POST|GET /api/v1/groups`
- `GET|PATCH|DELETE /api/v1/groups/:groupId`
- `GET|POST /api/v1/groups/:groupId/invitations`, `POST .../invitations/:invitationId/{resend,revoke}`
- `POST /api/v1/groups/invitations/{preview,accept}`
- `GET|POST /api/v1/groups/:groupId/categories`, `DELETE .../categories/:categoryId`
- `POST|GET /api/v1/groups/:groupId/events`
- `GET /api/v1/groups/:groupId/events/:eventId`
- `PATCH|DELETE /api/v1/groups/:groupId/events/:eventId`, `POST .../:eventId/cancel`, `PUT .../:eventId/rsvp` y `PUT .../:eventId/reminders`
- `POST|GET /api/v1/groups/:groupId/expenses`
- `GET /api/v1/groups/:groupId/expenses/:expenseId`
- `POST|GET /api/v1/groups/:groupId/settlements`
- `GET /api/v1/groups/:groupId/settlements/:settlementId`
- `PATCH /api/v1/groups/:groupId/settlements/:settlementId/transfers/:transferId/paid`
- Fondos: `/api/v1/groups/:groupId/funds` (CRUD, archivo, miembros, movimientos con `Idempotency-Key`).
- Presupuestos: `/api/v1/groups/:groupId/budgets` (progreso del periodo, historial y alertas).
- Documentos: `/api/v1/documents` (subida binaria validada por firma, permisos, URL firmada, bitácora).
- OCR: `/api/v1/ocr/jobs` (asíncrono; solo propone y exige confirmación humana).
- Cabudas: `/api/v1/cabudas/{summary,history}`; Estadísticas: `/api/v1/statistics/summary` y `/api/v1/statistics/summary/export` (CSV acotado, moneda explícita, escape de fórmulas y rate limit).
- Avisos: `/api/v1/notifications` (lista, contador, lectura, archivo, preferencias, `push-config` y suscripciones push).
- Logros: `/api/v1/achievements` y `/history`.
- Privacidad: `/api/v1/privacy/requests` (ARCO-POL, confirmación, cancelación, exportación JSON).

`tests/openapi-contract.test.ts` verifica que cada ruta implementada esté documentada en `docs/openapi.yaml` y viceversa.

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

Prisma no genera restricciones `CHECK`. Los servicios MVP verifican positividad, sumas, moneda, pertenencia y transiciones implementadas. Los modelos futuros todavía sin servicio solo documentan la intención y deberán incorporar validación antes de exponerse. Las migraciones gestionadas deben añadir restricciones de base de datos como defensa adicional cuando el dominio lo permita.

## Seguridad

- Contraseñas con Argon2id y salt administrado por la biblioteca.
- Tokens de sesión, invitación, verificación y recuperación aleatorios; PostgreSQL conserva solo SHA-256. Los enlaces de correo llevan el token en el fragmento `#token=` para que no llegue a logs ni Referer. Recuperar contraseña revoca todas las sesiones.
- Documentos: tipo permitido validado contra la firma binaria, nombre saneado, clave opaca nunca expuesta, descarga con `Content-Disposition: attachment`, `nosniff` y CSP `sandbox`. Sin acceso se responde 404 para no revelar existencia.
- Exportación de privacidad sin secretos, IP, user-agent ni datos personales de terceros. La supresión exige contraseña, anonimiza y conserva la integridad financiera de los demás.
- Sesiones expirables y revocables en cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Token CSRF por sesión en cabecera y cookie separada, comparado en tiempo constante.
- Las respuestas de autenticación y rutas privadas usan `Cache-Control: private, no-store`; health y readiness usan `no-store` para evitar estados obsoletos.
- RBAC `OWNER`, `ADMIN`, `MEMBER`; el actor siempre se deriva de la sesión.
- Helmet, CORS allowlist del cliente React (antes de los límites para que un 429 siga siendo legible), JSON máximo de 32 KB, rate limit global y límites específicos por IP, correo (hash) o usuario en autenticación, recuperación, invitaciones, subidas, OCR y privacidad, con `Retry-After`. `Cross-Origin-Resource-Policy` es `cross-origin` para que cabales-app en Vite pueda leer respuestas con cookies.
- Consultas parametrizadas mediante Prisma, errores centralizados y logs JSON sin secretos.
- Gastos, cierres, pagos y cambios parentales críticos usan transacciones `Serializable` con hasta tres intentos ante `P2034`.
- El cambio de moneda y borrado bloquean la fila del grupo; la creación de gasto toma un bloqueo compartido. Las FK hacen que creaciones concurrentes esperen o fallen de forma segura.
- El rate limit en memoria sirve a una instancia; producción usa Redis (`RATE_LIMIT_STORE=redis`) con incremento atómico en Lua. `TRUST_PROXY` debe coincidir exactamente con los saltos controlados; un valor excesivo permite falsificar la IP cliente.

## Modelo

El schema incluye `User`, `Account`, `Session`, `Group`, `GroupMember`, `GroupInvitation`, `Event`, `EventParticipant`, `EventLink`, `Expense`, `ExpenseParticipant`, `ExpensePayer`, `ExpenseItem`, `ExpenseItemAllocation`, `Receipt`, `OcrJob`, `Settlement`, `SettlementTransfer`, `TransferStatusHistory`, `Fund`, `FundMember`, `FundMovement`, `Category`, `Tag`, `ExpenseTag`, `Budget`, `RecurringExpense`, `Document`, `DocumentAccessGrant`, `DocumentAccessLog`, `PushSubscription`, `Notification`, `Achievement`, `UserAchievement`, `IdempotencyKey` y `AuditLog`.

Balances, saldos de fondos, consumo de presupuestos y estadísticas no se almacenan: se derivan de movimientos y gastos.

## Decisiones P1: OCR y items

Los errores de proveedor se exponen con el sobre uniforme `{ success: false, error }`; un proveedor no disponible responde `503 PROVIDER_UNAVAILABLE`, distinto de un fallo de red del cliente.

`OCR_PROVIDER=tesseract` usa Tesseract.js local en produccion para JPEG, PNG y WebP. Los PDFs se rechazan con un error de formato explicito. `OCR_TESSERACT_LANGS` admite combinaciones de modelos oficiales como `spa+eng`; para modelos entrenados propios, `OCR_TESSERACT_LANG_PATH` habilita los códigos adicionales y apunta a la carpeta que contiene sus archivos `.traineddata`. Los modelos oficiales pueden descargarse desde `https://github.com/tesseract-ocr/tessdata_fast/tree/main`, para evitar depender de red. El proveedor `local` sigue siendo un doble determinista bloqueado en produccion.

Descarga los modelos fuera del repositorio y configura la carpeta en el entorno del servidor:

```powershell
New-Item -ItemType Directory -Force .\tessdata | Out-Null
Invoke-WebRequest https://github.com/tesseract-ocr/tessdata_fast/raw/main/spa.traineddata -OutFile .\tessdata\spa.traineddata
Invoke-WebRequest https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata -OutFile .\tessdata\eng.traineddata
# OCR_TESSERACT_LANGS=spa+eng
# OCR_TESSERACT_LANG_PATH=C:\ruta\a\tessdata
```

El parser de tickets es puro, no inventa campos y conserva `null` cuando no reconoce un valor. Crear un gasto con `ocrJobId` usa los datos editados por la persona, valida propiedad, estado, permisos y pertenencia documental, y confirma el OCR y enlace del documento dentro de la misma transaccion idempotente.

Las estadísticas distinguen `spentCents` (total visible), `myShareCents` (suma de `shareCents` de participantes que pertenecen al usuario autenticado) y `myPaidCents` (suma de sus pagos). El flujo de integración de estadísticas crea dos gastos con Ana como única participante, por lo que ambas métricas personales suman 9,900 centavos.

## Verificación

Las pruebas unitarias cubren reparto exacto, entradas monetarias inválidas, determinismo, balances, reintentos acotados, expiración idempotente, URLs, DTO estrictos y pago repetido. Supertest cubre health, readiness fallido, sobre 404, límites auth, cache, cookies y recuperación CSRF sin conectarse a PostgreSQL. No se ejecutan pruebas destructivas ni integración contra una base del usuario.

Comandos de verificación:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm exec prisma format
pnpm exec prisma validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Para `prisma validate` basta una URL PostgreSQL sintácticamente válida; no abre una conexión.

La suite unitaria y HTTP no requiere servicios. `tests/integration` cubre, contra PostgreSQL real, registro y verificación, invitaciones (duplicado, reenvío, revocación, vista previa, aceptación), categorías, presupuesto con alerta, gasto, Cabudas antes y después del cierre, pago, estadísticas, fondos (idempotencia, permisos, retiros concurrentes sin saldo negativo), documentos (firma binaria, permisos, URL firmada), OCR con confirmación, logros, avisos, exportación y supresión de privacidad, recuperación de contraseña y retención; y con Redis, límites compartidos entre dos instancias.

## Límites actuales

- Gastos recurrentes y etiquetas siguen modelados sin endpoints; los enlaces de evento se gestionan dentro de la ediciÃ³n P3.
- Proveedores reales pendientes de decisión: correo (`http` compatible con Resend; SMTP no implementado). S3 compatible y Web Push/VAPID ya están disponibles por configuración; OCR `local` sigue reservado a desarrollo/pruebas.
- Los plazos `RETENTION_*_DAYS` y `PRIVACY_EXPORT_TTL_DAYS` son provisionales hasta validación legal. Rectificación y oposición quedan `IN_PROGRESS` para atención manual.
- No hay edición ni borrado de gastos financieros; al cerrar el evento quedan inmutables por diseño.
- Los invitados no tienen identidad autenticada y una transferencia suya debe marcarla un OWNER o ADMIN.
- El token de invitación se envía por correo y además se devuelve una sola vez al creador (`delivery: manual` cuando no hay proveedor real) para compartir el enlace; viaja en un fragmento de URL.
- El registro responde 409 `EMAIL_IN_USE` ante un correo existente: compromiso conocido de enumeración mitigado con límites por IP y correo.
- El claim de invitación es un `updateMany` condicional atómico antes del `upsert` de membresía.
- Los bloqueos `FOR UPDATE`/`FOR SHARE`, carreras de FK y colisiones únicas se implementan para PostgreSQL, pero requieren una prueba de concurrencia contra una base aislada que no se ejecutó en esta tarea.
- `pnpm-lock.yaml` es el único lockfile canónico; `package-lock.json` se eliminó para no mantener dos árboles de dependencias divergentes. Se excluyen `node_modules`, `dist`, cobertura y Prisma Client generado.
- Las migraciones versionadas viven en `prisma/migrations`; `pnpm db:migrate` aplica únicamente las migraciones existentes y no cambia el esquema automáticamente al arrancar.

## Decisiones P3

- La migración `20261003150000_events_rsvp_reminders_scheduler` es aditiva: campos opcionales, defaults para RSVP, preflight y CHECK `NOT VALID`/`VALIDATE CONSTRAINT`; añade `EventReminder` y `ScheduledJobRun` con índices únicos y de ejecución.
- `NotificationsService` conserva la deduplicación por usuario y `dedupeKey` incluso cuando la preferencia in-app está apagada: crea un registro archivado como marcador antes de correo o push.
- Los adaptadores locales siguen sin datos ficticios y no se usan para recordatorios; el planificador consulta solo PostgreSQL y los canales configurados.

## P4: gastos personales, recurrentes, etiquetas e historial

Las categorias personales se sirven en `GET|POST /categories` y se pueden editar o eliminar solo por su propietario. Las etiquetas admiten tambien `PATCH` dentro de su alcance. Los gastos personales quedan fuera de grupos, liquidaciones, cabudas y estadisticas grupales; el borrado ARCO y la exportacion incluyen sus datos propios.

La migración `20261004010000_p4_gastos_personales_recurrentes_etiquetas` permite gastos sin grupo ni evento, siempre ligados a `ownerUserId`. Las rutas personales son `GET|POST /expenses`, `GET|PATCH|DELETE /expenses/:expenseId`, `GET|POST /tags` y `GET|POST /recurring-expenses`; las rutas grupales añadidas son `/groups/:groupId/tags` y `/groups/:groupId/recurring-expenses`. El historial acepta `month`, `from`, `to`, `categoryId`, `tagId`, `groupId`, `text`, `scope`, `cursor` y `limit`, y devuelve la suma filtrada en `meta.total`.

El job `recurring-expenses` reutiliza el planificador P3. Cada ejecución usa una clave de periodo única en `Expense`, bloquea el recurrente y pausa con notificación si el evento grupal está cerrado o la plantilla dejó de ser válida. No hay variables de entorno nuevas.

## Principios aplicados

El contrato OpenAPI de P4 se comprueba contra todas las operaciones montadas, incluidos los routers personales separados y las acciones de pausa, reanudacion y borrado de recurrentes. No se documentan rutas personales que no esten montadas.

Se aplican SRP y separación de validación, negocio y persistencia; zero trust en body, parámetros, cookies y cabeceras; mínimo privilegio RBAC; atomicidad y aislamiento serializable; request/correlation ID; fallos seguros y mensajes controlados; health/readiness separados; logs sin secretos; y algoritmos puros, deterministas y verificables para dinero y liquidación.
