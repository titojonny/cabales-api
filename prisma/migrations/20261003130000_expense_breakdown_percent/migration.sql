-- P2: reparto porcentual y desglose monetario de gastos.
-- El nuevo valor enum se agrega antes de cualquier operación que pudiera usarlo.
ALTER TYPE "SplitMode" ADD VALUE IF NOT EXISTS 'PERCENT';

ALTER TABLE "Expense"
  ADD COLUMN "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tipCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ExpenseParticipant"
  ADD COLUMN "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tipCents" INTEGER NOT NULL DEFAULT 0;

-- Los gastos existentes no tenían cargos separados: su total pasa a ser subtotal.
UPDATE "Expense"
SET "subtotalCents" = "totalCents",
    "taxCents" = 0,
    "tipCents" = 0;

UPDATE "ExpenseParticipant"
SET "subtotalCents" = "shareCents",
    "taxCents" = 0,
    "tipCents" = 0;

-- Preflight explícito: la migración aborta con un diagnóstico antes de validar los CHECK.
DO $$
DECLARE
    v_count BIGINT;
    v_violations TEXT := '';
BEGIN
    SELECT COUNT(*) INTO v_count FROM "Expense"
    WHERE "totalCents" < 0 OR "subtotalCents" < 0 OR "taxCents" < 0 OR "tipCents" < 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Expense_nonnegative_amounts: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Expense"
    WHERE "subtotalCents" + "taxCents" + "tipCents" <> "totalCents";
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Expense_total_consistency: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "ExpenseParticipant"
    WHERE "shareCents" < 0 OR "subtotalCents" < 0 OR "taxCents" < 0 OR "tipCents" < 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- ExpenseParticipant_nonnegative_amounts: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "ExpenseParticipant"
    WHERE "subtotalCents" + "taxCents" + "tipCents" <> "shareCents";
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- ExpenseParticipant_share_consistency: %s fila(s)', v_count);
    END IF;

    IF v_violations <> '' THEN
        RAISE EXCEPTION USING MESSAGE = format(
            'No se pueden validar los CHECK de gastos:%s',
            v_violations
        );
    END IF;
END
$$;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amounts_nonnegative"
  CHECK ("totalCents" >= 0 AND "subtotalCents" >= 0 AND "taxCents" >= 0 AND "tipCents" >= 0) NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_total_consistency"
  CHECK ("subtotalCents" + "taxCents" + "tipCents" = "totalCents") NOT VALID;
ALTER TABLE "ExpenseParticipant" ADD CONSTRAINT "ExpenseParticipant_amounts_nonnegative"
  CHECK ("shareCents" >= 0 AND "subtotalCents" >= 0 AND "taxCents" >= 0 AND "tipCents" >= 0) NOT VALID;
ALTER TABLE "ExpenseParticipant" ADD CONSTRAINT "ExpenseParticipant_share_consistency"
  CHECK ("subtotalCents" + "taxCents" + "tipCents" = "shareCents") NOT VALID;

ALTER TABLE "Expense" VALIDATE CONSTRAINT "Expense_amounts_nonnegative";
ALTER TABLE "Expense" VALIDATE CONSTRAINT "Expense_total_consistency";
ALTER TABLE "ExpenseParticipant" VALIDATE CONSTRAINT "ExpenseParticipant_amounts_nonnegative";
ALTER TABLE "ExpenseParticipant" VALIDATE CONSTRAINT "ExpenseParticipant_share_consistency";
