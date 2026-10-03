-- P4: alcance personal de gastos, recurrencias completas y etiquetas propias.
-- La migracion es aditiva y deja fallar antes de validar si una instalacion antigua
-- contiene datos que no se pueden clasificar sin inventar propietario o alcance.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Expense"
    WHERE ("groupId" IS NULL OR "eventId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'P4 preflight: Expense existente sin groupId y eventId completos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Tag"
    WHERE "groupId" IS NULL
  ) THEN
    RAISE EXCEPTION 'P4 preflight: Tag existente sin grupo no tiene ownerUserId en el esquema anterior';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "RecurringExpense"
    WHERE "groupId" IS NULL
  ) THEN
    RAISE EXCEPTION 'P4 preflight: RecurringExpense existente sin grupo no tiene propietario migrable';
  END IF;
END $$;

ALTER TABLE "Expense" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "Expense" ALTER COLUMN "eventId" DROP NOT NULL;
ALTER TABLE "Expense" ADD COLUMN "ownerUserId" UUID;
ALTER TABLE "Expense" ADD COLUMN "recurringExpenseId" UUID;
ALTER TABLE "Expense" ADD COLUMN "recurringPeriodKey" VARCHAR(32);
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_groupId_fkey";
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_eventId_fkey";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_personal_or_group_scope"
  CHECK (
    ("groupId" IS NOT NULL AND "eventId" IS NOT NULL AND "ownerUserId" IS NULL)
    OR ("groupId" IS NULL AND "eventId" IS NULL AND "ownerUserId" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey"
  FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Expense_ownerUserId_occurredAt_idx" ON "Expense"("ownerUserId", "occurredAt");
CREATE UNIQUE INDEX "Expense_recurringExpenseId_recurringPeriodKey_key"
  ON "Expense"("recurringExpenseId", "recurringPeriodKey");
ALTER TABLE "Expense" VALIDATE CONSTRAINT "Expense_personal_or_group_scope";

ALTER TABLE "Category" ADD COLUMN "ownerUserId" UUID;
ALTER TABLE "Category" ADD CONSTRAINT "Category_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Category_ownerUserId_name_key" ON "Category"("ownerUserId", "name");
CREATE INDEX "Category_ownerUserId_idx" ON "Category"("ownerUserId");

ALTER TABLE "Tag" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "Tag" ADD COLUMN "ownerUserId" UUID;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_scope_check"
  CHECK (("groupId" IS NOT NULL AND "ownerUserId" IS NULL) OR ("groupId" IS NULL AND "ownerUserId" IS NOT NULL)) NOT VALID;
CREATE UNIQUE INDEX "Tag_ownerUserId_name_key" ON "Tag"("ownerUserId", "name");
CREATE INDEX "Tag_ownerUserId_idx" ON "Tag"("ownerUserId");
ALTER TABLE "Tag" VALIDATE CONSTRAINT "Tag_scope_check";

ALTER TABLE "RecurringExpense" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "RecurringExpense" ADD COLUMN "eventId" UUID;
ALTER TABLE "RecurringExpense" ADD COLUMN "ownerUserId" UUID;
ALTER TABLE "RecurringExpense" ADD COLUMN "createdById" UUID;
ALTER TABLE "RecurringExpense" ADD COLUMN "notes" VARCHAR(1000);
ALTER TABLE "RecurringExpense" ADD COLUMN "categoryId" UUID;
ALTER TABLE "RecurringExpense" ADD COLUMN "chargeDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecurringExpense" ADD COLUMN "endsAt" TIMESTAMP(3);
ALTER TABLE "RecurringExpense" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "RecurringExpense" AS recurring
SET "createdById" = "Group"."createdById"
FROM "Group"
WHERE recurring."groupId" = "Group"."id" AND recurring."createdById" IS NULL;
ALTER TABLE "RecurringExpense" DROP CONSTRAINT IF EXISTS "RecurringExpense_groupId_fkey";
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_scope_check"
  CHECK (("groupId" IS NOT NULL AND "ownerUserId" IS NULL) OR ("groupId" IS NULL AND "ownerUserId" IS NOT NULL)) NOT VALID;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_chargeDay_check"
  CHECK ("chargeDay" BETWEEN 1 AND 31) NOT VALID;
CREATE INDEX "RecurringExpense_ownerUserId_isActive_idx" ON "RecurringExpense"("ownerUserId", "isActive");
ALTER TABLE "RecurringExpense" VALIDATE CONSTRAINT "RecurringExpense_scope_check";
ALTER TABLE "RecurringExpense" VALIDATE CONSTRAINT "RecurringExpense_chargeDay_check";

CREATE TABLE "RecurringExpenseParticipant" (
  "id" UUID NOT NULL,
  "recurringExpenseId" UUID NOT NULL,
  "eventParticipantId" UUID NOT NULL,
  "shareCents" INTEGER NOT NULL,
  "payerAmountCents" INTEGER,
  CONSTRAINT "RecurringExpenseParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecurringExpenseParticipant_recurringExpenseId_eventParticipantId_key"
  ON "RecurringExpenseParticipant"("recurringExpenseId", "eventParticipantId");
CREATE INDEX "RecurringExpenseParticipant_eventParticipantId_idx"
  ON "RecurringExpenseParticipant"("eventParticipantId");
ALTER TABLE "RecurringExpenseParticipant" ADD CONSTRAINT "RecurringExpenseParticipant_recurringExpenseId_fkey"
  FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpenseParticipant" ADD CONSTRAINT "RecurringExpenseParticipant_eventParticipantId_fkey"
  FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RecurringExpenseTag" (
  "recurringExpenseId" UUID NOT NULL,
  "tagId" UUID NOT NULL,
  CONSTRAINT "RecurringExpenseTag_pkey" PRIMARY KEY ("recurringExpenseId", "tagId")
);
CREATE INDEX "RecurringExpenseTag_tagId_idx" ON "RecurringExpenseTag"("tagId");
ALTER TABLE "RecurringExpenseTag" ADD CONSTRAINT "RecurringExpenseTag_recurringExpenseId_fkey"
  FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpenseTag" ADD CONSTRAINT "RecurringExpenseTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
