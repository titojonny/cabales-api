.env.example: documenta cada variable, su propósito seguro y los valores exclusivamente locales.
.dockerignore: declara exclusiones del contexto de build de la imagen Express.
.gitignore: organiza secretos, artefactos, volúmenes, logs, IDE y archivos generados mediante secciones comentadas.
.prettierignore: sus patrones declarativos excluyen dependencias, artefactos, cobertura y lockfile sin requerir comentarios adicionales.
.prettierrc.json: JSON no admite comentarios; este registro documenta que fija comillas simples, coma final y ancho 100.
DOCUMENTACION.md: registra una línea por archivo mantenido, incluido el lockfile, y declara en README las salidas generadas no mantenidas.
Dockerfile: documenta el build multi-etapa, Prisma generate y el runtime sin mutaciones de esquema al arrancar.
README.md: contiene arquitectura, instalación, scripts, seguridad, contrato, invariantes, verificación, límites y principios.
docker-compose.yml: comenta el alcance local y declara PostgreSQL, Redis de límites, API Express, persistencia de base y documentos, y healthchecks con claves oficiales.
docs/openapi.yaml: comenta su función y documenta rutas, seguridad, parámetros, cuerpos, sobres y DTO implementados.
eslint.config.js: incluye TSDoc de la configuración exportada y reglas declarativas legibles.
package.json: JSON sin comentarios; nombres de scripts y metadatos describen ejecución, generación reproducible, calidad y ciclo de base de datos.
prisma.config.ts: documenta con TSDoc la configuración Prisma 7 de schema, seed y URL externa.
prisma/schema.prisma: usa comentarios Prisma para fuentes derivadas, seguridad, centavos e invariantes sin CHECK.
prisma/seed.ts: documenta que el seed es idempotente y nunca crea credenciales predeterminadas.
src/config/env.ts: documenta la carga de .env, validación fail-fast y configuración canónica.
src/config/logger.ts: documenta la creación del logger JSON y la redacción defensiva de secretos.
src/database/client.ts: documenta la construcción perezosa del adaptador PostgreSQL y sus tipos de infraestructura.
src/database/transaction.ts: documenta la detección P2034 y el máximo finito de reintentos serializables.
src/composition.ts: construye proveedores, servicios y app; suscribe avisos y logros a eventos de dominio.
src/infrastructure/background.ts: ejecuta tareas diferidas sin bloquear respuestas y permite drenarlas al cerrar.
src/infrastructure/email.ts: define el puerto de correo, el proveedor de registro sin contenido, el HTTP compatible con Resend y las plantillas.
src/infrastructure/errors.ts: define el error estable de proveedor externo.
src/infrastructure/http-client.ts: cliente saliente con timeout, reintentos acotados y códigos estables.
src/infrastructure/ocr.ts: puerto OCR, proveedor deshabilitado, local determinista solo de desarrollo y proveedor HTTP con propuesta validada.
src/infrastructure/push.ts: puerto Web Push deshabilitado y proveedor real VAPID con reintentos y caducidad.
src/infrastructure/rate-limit.ts: store Redis atómico, fábrica memoria/Redis y limitadores por IP, usuario o hash de correo.
src/infrastructure/storage.ts: almacenamiento local y S3 compatible con claves opacas, URLs firmadas y validación de firma binaria.
src/jobs/retention.ts: punto de entrada del job de retención con modo dry-run.
src/http/app.ts: documenta dependencias explícitas, composición modular, CORS del cliente React y CORP cruzado.
src/http/express.d.ts: documenta el contexto de request confiable añadido por autenticación y correlación.
src/http/middleware.ts: documenta request ID, cache privada, sesión, recuperación CSRF, 404 y errores.
src/http/response.ts: documenta el emisor único del sobre exitoso v1.
src/index.ts: documenta el cierre controlado y mantiene legible la composición de dependencias de producción.
src/modules/auth/auth.repository.ts: documenta la responsabilidad exclusiva de persistencia de identidades y sesiones.
src/modules/auth/auth.router.ts: documenta cookies, recuperación CSRF validada y protección de logout.
src/modules/auth/auth.schema.ts: documenta contratos canónicos de registro y login.
src/modules/auth/auth.service.ts: documenta contexto confiable, material efímero, puerto HTTP y reglas de autenticación.
src/modules/events/events.repository.ts: documenta consultas y escritura del evento con su padrón canónico.
src/modules/events/events.router.ts: documenta los endpoints de eventos anidados bajo grupos.
src/modules/events/events.schema.ts: documenta límites del contrato de evento, miembros, invitados y enlaces.
src/modules/events/events.service.ts: documenta las reglas de pertenencia y contexto de participantes.
src/modules/expenses/expenses.repository.ts: documenta bloqueos de moneda, copia de identidad, expiración idempotente y persistencia serializable.
src/modules/expenses/expenses.router.ts: documenta la frontera financiera de gastos y su anidación por grupo.
src/modules/expenses/expenses.schema.ts: documenta la separación entre validación estructural e invariantes de negocio.
src/modules/expenses/expenses.service.ts: documenta reparto, sumas exactas, pertenencia y ciclo de vida de gastos.
src/modules/groups/groups.repository.ts: documenta bloqueos parentales, actualización/borrado atómicos y claim de invitación.
src/modules/groups/groups.router.ts: documenta CRUD e invitaciones bajo autenticación y CSRF externos.
src/modules/groups/groups.schema.ts: documenta contratos canónicos de grupo, actualización e invitación.
src/modules/groups/groups.service.ts: documenta membresía mínima, RBAC y ciclo de vida de grupos.
src/modules/settlements/settlements.repository.ts: documenta reintentos, expiración, colisiones de cierre y convergencia de pagos.
src/modules/settlements/settlements.router.ts: documenta endpoints de cierre, consulta y confirmación de pago.
src/modules/settlements/settlements.schema.ts: documenta el identificador del evento que se cierra una sola vez.
src/modules/settlements/settlements.service.ts: documenta cálculo desde fuentes reales, RBAC y autorización de pagos.
src/modules/achievements/_: catálogo de logros, evaluación idempotente y rutas de consulta.
src/modules/budgets/_: presupuestos por periodo, progreso derivado de gastos, historial y alertas.
src/modules/cabudas/_: consolidación de deudas por moneda, grupo y persona, e historial.
src/modules/documents/_: documentos privados, permisos, bitácora, URL firmada y descarga local o S3 compatible.
src/modules/funds/_: fondos, miembros y movimientos inmutables con saldo derivado e idempotencia.
src/modules/notifications/_: avisos internos, preferencias, deduplicación y suscripciones push.
src/modules/ocr/_: trabajos OCR asíncronos, proveedor local determinista de desarrollo, reintentos y confirmación humana.
src/modules/privacy/_: solicitudes ARCO-POL, exportación, supresión anonimizada y servicio de retención.
src/modules/statistics/_: agregados autorizados de gasto, tendencia, presupuestos y exportación CSV protegida.
src/shared/events.ts: bus tipado de eventos de dominio.
src/shared/periods.ts: ventanas de periodos UTC para presupuestos y estadísticas.
src/shared/crypto.ts: documenta generación, hash, serialización estable y huella idempotente.
src/shared/errors.ts: documenta errores controlados y aserciones de precondiciones.
src/shared/idempotency.ts: documenta la decisión determinista de vigencia de una llave idempotente.
src/shared/money.ts: documenta enteros positivos, suma segura, reparto determinista, igualdad exacta y moneda.
src/shared/settlement.ts: documenta balances, plan de transferencia y algoritmo puro determinista.
src/shared/validation.ts: documenta validación canónica de body, UUID y cabecera idempotente.
tests/http.test.ts: los casos documentan health, readiness, sobre, cache, CORS del cliente React, límites auth, cookies y recuperación CSRF.
tests/expenses.service.test.ts: los casos documentan reproducción idempotente vigente y reclamación tras ausencia o expiración.
tests/money.test.ts: los nombres de casos documentan reparto exacto y rechazo de entradas monetarias inválidas.
tests/settlement.test.ts: los nombres de casos documentan consolidación, determinismo, balance y caso liquidado.
tests/settlements.service.test.ts: los casos documentan recuperación de pago repetido y rechazo de estados terminales.
tests/transaction.test.ts: los casos documentan reintento P2034 acotado y reutilización tras expiración.
tests/validation.test.ts: los casos documentan DTO estrictos, URL HTTP(S) y configuración segura de proxy.
tests/config.test.ts: documenta requisitos de producción (Redis, secreto de firma, CORS) y advertencias.
tests/infrastructure.test.ts: documenta correo sin fugas, cliente saliente, OCR local/HTTP, Web Push, almacenamiento firmado y store Redis.
tests/statistics.test.ts: documenta escape RFC 4180, neutralización de fórmulas y límite de filas.
tests/periods.test.ts: documenta ventanas de periodo y bordes de mes.
tests/openapi-contract.test.ts: verifica que rutas implementadas y documentadas coincidan.
tests/integration/_: flujo completo contra PostgreSQL, CSV, almacenamiento S3/MinIO gated y límites compartidos con Redis, activados por TEST_DATABASE_URL, TEST_S3_* y TEST_REDIS_URL.
prisma/migrations/*: migraciones versionadas; la segunda añade módulos, privacidad, documentos y fondos con restricciones CHECK.
tsconfig.build.json: JSON sin comentarios; este registro documenta compilación exclusiva de fuente hacia dist con declaraciones.
tsconfig.json: JSON sin comentarios; este registro documenta tipado estricto de fuente, pruebas y configuración.
