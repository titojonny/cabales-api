# ==========================================
# Etapa 1: Build y compilación (TypeScript & Prisma)
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Dependencias del sistema necesarias para módulos nativos (better-sqlite3) y OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copiar manifiestos e instalar dependencias
COPY package.json package-lock.json ./
RUN npm ci

# Copiar configuración de Prisma y generar el cliente
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Copiar código fuente y compilar TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Limpiar dependencias de desarrollo
RUN npm prune --omit=dev

# ==========================================
# Etapa 2: Imagen final de producción (Ligera y Segura)
# ==========================================
FROM node:22-slim AS runner

WORKDIR /app

# OpenSSL es requerido en runtime por el motor de Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:/app/data/dev.db"

# Copiar artefactos compilados y dependencias de producción
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Crear carpetas persistentes para base de datos y comprobantes
RUN mkdir -p /app/data /app/uploads/comprobantes

# Exponer puerto HTTP
EXPOSE 3000

# Aplicar migraciones pendientes y arrancar el servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
