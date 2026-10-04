-- Corrige el drift de P7 y estabiliza el nombre truncado por PostgreSQL (63 bytes).
ALTER TABLE "Income" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'RecurringExpenseParticipant'
      AND indexname = 'RecurringExpenseParticipant_recurringExpenseId_eventParticipant'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'RecurringExpenseParticipant'
      AND indexname = 'RecurringExpenseParticipant_recurringExpenseId_eventPartici_key'
  ) THEN
    ALTER INDEX "RecurringExpenseParticipant_recurringExpenseId_eventParticipant"
      RENAME TO "RecurringExpenseParticipant_recurringExpenseId_eventPartici_key";
  END IF;
END $$;
