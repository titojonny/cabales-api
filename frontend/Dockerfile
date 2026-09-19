# ==========================================
# Etapa 1: Build de la aplicación Angular / Ionic
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Copiar dependencias e instalar
COPY package.json package-lock.json ./
RUN npm ci

# Copiar código fuente y compilar bundle de producción
COPY . .
RUN npm run build

# ==========================================
# Etapa 2: Servidor Nginx ultra-ligero
# ==========================================
FROM nginx:alpine

# Copiar archivos compilados en www
COPY --from=builder /app/www /usr/share/nginx/html

# Copiar configuración de Nginx para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
