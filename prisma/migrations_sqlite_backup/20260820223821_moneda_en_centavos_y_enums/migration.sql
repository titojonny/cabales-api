/*
  Warnings:

  - You are about to drop the column `total_gastado` on the `Evento` table. All the data in the column will be lost.
  - You are about to drop the column `monto_consumido` on the `Participante` table. All the data in the column will be lost.
  - You are about to drop the column `monto_pagado` on the `Participante` table. All the data in the column will be lost.
  - You are about to drop the column `monto` on the `Transaccion` table. All the data in the column will be lost.
  - Added the required column `monto_centavos` to the `Transaccion` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Evento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creador_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "total_gastado_centavos" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Evento_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Evento" ("creador_id", "estado", "fecha", "id", "nombre") SELECT "creador_id", "estado", "fecha", "id", "nombre" FROM "Evento";
DROP TABLE "Evento";
ALTER TABLE "new_Evento" RENAME TO "Evento";
CREATE INDEX "Evento_creador_id_idx" ON "Evento"("creador_id");
CREATE TABLE "new_Participante" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "nombre_invitado" TEXT,
    "monto_consumido_centavos" INTEGER NOT NULL DEFAULT 0,
    "monto_pagado_centavos" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Participante_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Participante_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Participante" ("evento_id", "id", "nombre_invitado", "usuario_id") SELECT "evento_id", "id", "nombre_invitado", "usuario_id" FROM "Participante";
DROP TABLE "Participante";
ALTER TABLE "new_Participante" RENAME TO "Participante";
CREATE INDEX "Participante_evento_id_idx" ON "Participante"("evento_id");
CREATE INDEX "Participante_usuario_id_idx" ON "Participante"("usuario_id");
CREATE TABLE "new_Transaccion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evento_id" TEXT NOT NULL,
    "deudor_id" TEXT NOT NULL,
    "acreedor_id" TEXT NOT NULL,
    "monto_centavos" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "comprobante_url" TEXT,
    "fecha_limite" DATETIME,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" DATETIME NOT NULL,
    CONSTRAINT "Transaccion_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaccion_deudor_id_fkey" FOREIGN KEY ("deudor_id") REFERENCES "Participante" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaccion_acreedor_id_fkey" FOREIGN KEY ("acreedor_id") REFERENCES "Participante" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaccion" ("acreedor_id", "actualizado_en", "comprobante_url", "creado_en", "deudor_id", "estado", "evento_id", "fecha_limite", "id") SELECT "acreedor_id", "actualizado_en", "comprobante_url", "creado_en", "deudor_id", "estado", "evento_id", "fecha_limite", "id" FROM "Transaccion";
DROP TABLE "Transaccion";
ALTER TABLE "new_Transaccion" RENAME TO "Transaccion";
CREATE INDEX "Transaccion_evento_id_idx" ON "Transaccion"("evento_id");
CREATE INDEX "Transaccion_deudor_id_idx" ON "Transaccion"("deudor_id");
CREATE INDEX "Transaccion_acreedor_id_idx" ON "Transaccion"("acreedor_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
