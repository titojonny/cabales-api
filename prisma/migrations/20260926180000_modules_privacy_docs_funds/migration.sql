-- Diferencias del schema: persistencia de privacidad, retención, documentos, OCR, fondos,
-- presupuestos y notificaciones. Generado con prisma migrate diff y ampliado con CHECK.
-- CreateEnum
CREATE TYPE "RetentionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RetentionTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- DropIndex
DROP INDEX "Document_groupId_idx";

-- DropIndex
DROP INDEX "Document_ownerId_idx";

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "alertThresholdPercent" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "checksumSha256" CHAR(64),
ADD COLUMN     "eventId" UUID,
ADD COLUMN     "expenseId" UUID,
ADD COLUMN     "settlementId" UUID,
ADD COLUMN     "sizeBytes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "description" VARCHAR(500),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "GroupInvitation" ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" UUID,
ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "dedupeKey" VARCHAR(200);

-- AlterTable
ALTER TABLE "OcrJob" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedExpenseId" UUID,
ADD COLUMN     "documentId" UUID,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "requestedById" UUID,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ALTER COLUMN "receiptId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PrivacyRequest" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "exportExpiresAt" TIMESTAMP(3),
ADD COLUMN     "resultSummary" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId","type")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" UUID NOT NULL,
    "trigger" "RetentionTrigger" NOT NULL,
    "status" "RetentionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "counts" JSONB,
    "errorCode" VARCHAR(80),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionRun_startedAt_idx" ON "RetentionRun"("startedAt");

-- CreateIndex
CREATE INDEX "RetentionRun_status_startedAt_idx" ON "RetentionRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "Document_groupId_createdAt_idx" ON "Document"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_ownerId_createdAt_idx" ON "Document"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_eventId_idx" ON "Document"("eventId");

-- CreateIndex
CREATE INDEX "Document_expenseId_idx" ON "Document"("expenseId");

-- CreateIndex
CREATE INDEX "Document_settlementId_idx" ON "Document"("settlementId");

-- CreateIndex
CREATE INDEX "FundMember_groupMemberId_idx" ON "FundMember"("groupMemberId");

-- CreateIndex
CREATE INDEX "GroupInvitation_groupId_email_status_idx" ON "GroupInvitation"("groupId", "email", "status");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OcrJob_documentId_createdAt_idx" ON "OcrJob"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "OcrJob_requestedById_createdAt_idx" ON "OcrJob"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "OcrJob_confirmedExpenseId_idx" ON "OcrJob"("confirmedExpenseId");

-- CreateIndex
CREATE INDEX "PrivacyRequest_type_status_idx" ON "PrivacyRequest"("type", "status");

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_confirmedExpenseId_fkey" FOREIGN KEY ("confirmedExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariantes que Prisma no expresa; los servicios las validan antes de escribir.
-- Se cuentan antes de tocar las tablas para que una base con datos falle con
-- un diagnóstico claro. El error hace que toda la migración sea atómica.
DO $$
DECLARE
    v_count BIGINT;
    v_violations TEXT := '';
BEGIN
    SELECT COUNT(*) INTO v_count FROM "Budget" WHERE "amountCents" <= 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Budget_amountCents_positive: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Budget"
    WHERE "alertThresholdPercent" NOT BETWEEN 1 AND 100;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Budget_alertThresholdPercent_range: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Budget"
    WHERE "endsAt" IS NOT NULL AND "endsAt" <= "startsAt";
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Budget_period_range: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Budget"
    WHERE "period" = 'CUSTOM' AND "endsAt" IS NULL;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Budget_custom_requires_endsAt: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "FundMovement"
    WHERE NOT (
        ("type" = 'CONTRIBUTION' AND "amountCents" > 0)
        OR ("type" = 'WITHDRAWAL' AND "amountCents" < 0)
        OR ("type" = 'ADJUSTMENT' AND "amountCents" <> 0)
    );
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- FundMovement_type_amountCents_consistent: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Document" WHERE "sizeBytes" < 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Document_sizeBytes_nonnegative: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "OcrJob" WHERE "attempts" < 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- OcrJob_attempts_nonnegative: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "GroupInvitation" WHERE "sendCount" < 1;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- GroupInvitation_sendCount_positive: %s fila(s)', v_count);
    END IF;

    IF v_violations <> '' THEN
        RAISE EXCEPTION USING MESSAGE = format(
            'No se pueden agregar los CHECK: hay filas que violan estas reglas:%s',
            v_violations
        );
    END IF;
END
$$;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_amountCents_positive"
    CHECK ("amountCents" > 0) NOT VALID;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_alertThresholdPercent_range"
    CHECK ("alertThresholdPercent" BETWEEN 1 AND 100) NOT VALID;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_period_range"
    CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt") NOT VALID;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_custom_requires_endsAt"
    CHECK ("period" <> 'CUSTOM' OR "endsAt" IS NOT NULL) NOT VALID;
ALTER TABLE "FundMovement" ADD CONSTRAINT "FundMovement_type_amountCents_consistent"
    CHECK (
        ("type" = 'CONTRIBUTION' AND "amountCents" > 0)
        OR ("type" = 'WITHDRAWAL' AND "amountCents" < 0)
        OR ("type" = 'ADJUSTMENT' AND "amountCents" <> 0)
    ) NOT VALID;
ALTER TABLE "Document" ADD CONSTRAINT "Document_sizeBytes_nonnegative"
    CHECK ("sizeBytes" >= 0) NOT VALID;
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_attempts_nonnegative"
    CHECK ("attempts" >= 0) NOT VALID;
ALTER TABLE "GroupInvitation" ADD CONSTRAINT "GroupInvitation_sendCount_positive"
    CHECK ("sendCount" >= 1) NOT VALID;

ALTER TABLE "Budget" VALIDATE CONSTRAINT "Budget_amountCents_positive";
ALTER TABLE "Budget" VALIDATE CONSTRAINT "Budget_alertThresholdPercent_range";
ALTER TABLE "Budget" VALIDATE CONSTRAINT "Budget_period_range";
ALTER TABLE "Budget" VALIDATE CONSTRAINT "Budget_custom_requires_endsAt";
ALTER TABLE "FundMovement" VALIDATE CONSTRAINT "FundMovement_type_amountCents_consistent";
ALTER TABLE "Document" VALIDATE CONSTRAINT "Document_sizeBytes_nonnegative";
ALTER TABLE "OcrJob" VALIDATE CONSTRAINT "OcrJob_attempts_nonnegative";
ALTER TABLE "GroupInvitation" VALIDATE CONSTRAINT "GroupInvitation_sendCount_positive";
