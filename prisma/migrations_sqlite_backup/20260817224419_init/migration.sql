-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatar_url" TEXT,
    "fecha_registro" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creador_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "total_gastado" REAL NOT NULL DEFAULT 0.00,
    CONSTRAINT "Evento_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Participante" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "nombre_invitado" TEXT,
    "monto_consumido" REAL NOT NULL DEFAULT 0.00,
    "monto_pagado" REAL NOT NULL DEFAULT 0.00,
    CONSTRAINT "Participante_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Participante_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaccion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evento_id" TEXT NOT NULL,
    "deudor_id" TEXT NOT NULL,
    "acreedor_id" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "comprobante_url" TEXT,
    "fecha_limite" DATETIME,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" DATETIME NOT NULL,
    CONSTRAINT "Transaccion_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaccion_deudor_id_fkey" FOREIGN KEY ("deudor_id") REFERENCES "Participante" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaccion_acreedor_id_fkey" FOREIGN KEY ("acreedor_id") REFERENCES "Participante" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
