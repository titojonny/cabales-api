-- CreateTable
CREATE TABLE "Consumo" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "descripcion" TEXT,
    "monto_centavos" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoParticipante" (
    "id" TEXT NOT NULL,
    "consumo_id" TEXT NOT NULL,
    "participante_id" TEXT NOT NULL,
    "monto_centavos" INTEGER NOT NULL,

    CONSTRAINT "ConsumoParticipante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consumo_evento_id_idx" ON "Consumo"("evento_id");

-- CreateIndex
CREATE INDEX "ConsumoParticipante_consumo_id_idx" ON "ConsumoParticipante"("consumo_id");

-- CreateIndex
CREATE INDEX "ConsumoParticipante_participante_id_idx" ON "ConsumoParticipante"("participante_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumoParticipante_consumo_id_participante_id_key" ON "ConsumoParticipante"("consumo_id", "participante_id");

-- AddForeignKey
ALTER TABLE "Consumo" ADD CONSTRAINT "Consumo_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "Evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoParticipante" ADD CONSTRAINT "ConsumoParticipante_consumo_id_fkey" FOREIGN KEY ("consumo_id") REFERENCES "Consumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoParticipante" ADD CONSTRAINT "ConsumoParticipante_participante_id_fkey" FOREIGN KEY ("participante_id") REFERENCES "Participante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
