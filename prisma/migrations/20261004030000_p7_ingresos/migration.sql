-- P7: ingresos personales, aislados de grupos, documentos y privacidad.

DO $$
BEGIN
  IF to_regclass('"User"') IS NULL THEN
    RAISE EXCEPTION 'P7 requiere la tabla "User" antes de crear ingresos';
  END IF;
END $$;

CREATE TABLE "Income" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "note" VARCHAR(500),
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- Preflight explícito antes de validar las restricciones nuevas.
DO $$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM "Income"
  WHERE "amountCents" <= 0 OR "category" = '' OR "currency" !~ '^[A-Z]{3}$';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'No se pueden validar los datos de ingresos: % fila(s) incumplen importe, categoría o moneda', v_count;
  END IF;
END $$;

ALTER TABLE "Income"
  ADD CONSTRAINT "Income_amountCents_positive" CHECK ("amountCents" > 0) NOT VALID,
  ADD CONSTRAINT "Income_category_not_blank" CHECK (length(btrim("category")) > 0) NOT VALID,
  ADD CONSTRAINT "Income_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "Income" VALIDATE CONSTRAINT "Income_amountCents_positive";
ALTER TABLE "Income" VALIDATE CONSTRAINT "Income_category_not_blank";
ALTER TABLE "Income" VALIDATE CONSTRAINT "Income_currency_format";

CREATE INDEX "Income_userId_date_idx" ON "Income"("userId", "date");
CREATE INDEX "Income_userId_currency_date_idx" ON "Income"("userId", "currency", "date");

ALTER TABLE "Income"
  ADD CONSTRAINT "Income_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
