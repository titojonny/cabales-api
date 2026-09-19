-- CreateEnum
CREATE TYPE "EstadoEvento" AS ENUM ('ACTIVO', 'CERRADO');

-- CreateEnum
CREATE TYPE "EstadoTransaccion" AS ENUM ('PENDIENTE', 'EN_REVISION', 'EN_DISPUTA', 'COMPLETADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatar_url" TEXT,
    "fecha_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evento" (
    "id" TEXT NOT NULL,
    "creador_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoEvento" NOT NULL DEFAULT 'ACTIVO',
    "total_gastado_centavos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participante" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "nombre_invitado" TEXT,
    "monto_consumido_centavos" INTEGER NOT NULL DEFAULT 0,
    "monto_pagado_centavos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Participante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaccion" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "deudor_id" TEXT NOT NULL,
    "acreedor_id" TEXT NOT NULL,
    "monto_centavos" INTEGER NOT NULL,
    "estado" "EstadoTransaccion" NOT NULL DEFAULT 'PENDIENTE',
    "comprobante_url" TEXT,
    "fecha_limite" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Evento_creador_id_idx" ON "Evento"("creador_id");

-- CreateIndex
CREATE INDEX "Participante_evento_id_idx" ON "Participante"("evento_id");

-- CreateIndex
CREATE INDEX "Participante_usuario_id_idx" ON "Participante"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "Participante_evento_id_usuario_id_key" ON "Participante"("evento_id", "usuario_id");

-- CreateIndex
CREATE INDEX "Transaccion_evento_id_idx" ON "Transaccion"("evento_id");

-- CreateIndex
CREATE INDEX "Transaccion_deudor_id_idx" ON "Transaccion"("deudor_id");

-- CreateIndex
CREATE INDEX "Transaccion_acreedor_id_idx" ON "Transaccion"("acreedor_id");

-- AddForeignKey
ALTER TABLE "Evento" ADD CONSTRAINT "Evento_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participante" ADD CONSTRAINT "Participante_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participante" ADD CONSTRAINT "Participante_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaccion" ADD CONSTRAINT "Transaccion_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaccion" ADD CONSTRAINT "Transaccion_deudor_id_fkey" FOREIGN KEY ("deudor_id") REFERENCES "Participante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaccion" ADD CONSTRAINT "Transaccion_acreedor_id_fkey" FOREIGN KEY ("acreedor_id") REFERENCES "Participante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
