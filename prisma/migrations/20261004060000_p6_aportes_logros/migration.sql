-- P6: solicitudes de aportes, vencimiento de transferencias y privacidad/rango de logros.
-- La migracion es aditiva: no modifica ni elimina datos existentes.

ALTER TABLE "User"
  ADD COLUMN "achievementRankingVisible" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SettlementTransfer"
  ADD COLUMN "dueAt" TIMESTAMP(3);

ALTER TABLE "FundMovement"
  ADD COLUMN "contributionRequestMemberId" UUID;

ALTER TABLE "UserAchievement"
  ADD COLUMN "level" VARCHAR(10) NOT NULL DEFAULT 'BRONZE';

CREATE TABLE "FundContributionRequest" (
    "id" UUID NOT NULL,
    "fundId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundContributionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FundContributionRequestMember" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fundMemberId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "FundContributionRequestMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundMovement_contributionRequestMemberId_key"
  ON "FundMovement"("contributionRequestMemberId");
CREATE INDEX "FundContributionRequest_fundId_dueAt_idx"
  ON "FundContributionRequest"("fundId", "dueAt");
CREATE INDEX "FundContributionRequest_createdById_idx"
  ON "FundContributionRequest"("createdById");
CREATE UNIQUE INDEX "FundContributionRequestMember_requestId_fundMemberId_key"
  ON "FundContributionRequestMember"("requestId", "fundMemberId");
CREATE INDEX "FundContributionRequestMember_fundMemberId_status_idx"
  ON "FundContributionRequestMember"("fundMemberId", "status");
CREATE INDEX "FundContributionRequestMember_requestId_status_idx"
  ON "FundContributionRequestMember"("requestId", "status");

ALTER TABLE "FundContributionRequest"
  ADD CONSTRAINT "FundContributionRequest_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundContributionRequest"
  ADD CONSTRAINT "FundContributionRequest_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundContributionRequestMember"
  ADD CONSTRAINT "FundContributionRequestMember_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "FundContributionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundContributionRequestMember"
  ADD CONSTRAINT "FundContributionRequestMember_fundMemberId_fkey"
  FOREIGN KEY ("fundMemberId") REFERENCES "FundMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundMovement"
  ADD CONSTRAINT "FundMovement_contributionRequestMemberId_fkey"
  FOREIGN KEY ("contributionRequestMemberId") REFERENCES "FundContributionRequestMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
    v_count BIGINT;
    v_violations TEXT := '';
BEGIN
    SELECT COUNT(*) INTO v_count FROM "UserAchievement"
    WHERE "level" NOT IN ('BRONZE', 'SILVER', 'GOLD');
    IF v_count > 0 THEN
      v_violations := v_violations || format(E'\n- UserAchievement_level: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "FundContributionRequestMember"
    WHERE "amountCents" <= 0;
    IF v_count > 0 THEN
      v_violations := v_violations || format(E'\n- FundContributionRequestMember_amountCents: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "FundContributionRequestMember"
    WHERE "status" NOT IN ('PENDING', 'PAID', 'OVERDUE');
    IF v_count > 0 THEN
      v_violations := v_violations || format(E'\n- FundContributionRequestMember_status: %s fila(s)', v_count);
    END IF;

    IF v_violations <> '' THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'No se pueden validar las restricciones P6:%s', v_violations
      );
    END IF;
END
$$;

ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_level_check"
  CHECK ("level" IN ('BRONZE', 'SILVER', 'GOLD')) NOT VALID;
ALTER TABLE "FundContributionRequestMember" ADD CONSTRAINT "FundContributionRequestMember_amountCents_check"
  CHECK ("amountCents" > 0) NOT VALID;
ALTER TABLE "FundContributionRequestMember" ADD CONSTRAINT "FundContributionRequestMember_status_check"
  CHECK ("status" IN ('PENDING', 'PAID', 'OVERDUE')) NOT VALID;

ALTER TABLE "UserAchievement" VALIDATE CONSTRAINT "UserAchievement_level_check";
ALTER TABLE "FundContributionRequestMember" VALIDATE CONSTRAINT "FundContributionRequestMember_amountCents_check";
ALTER TABLE "FundContributionRequestMember" VALIDATE CONSTRAINT "FundContributionRequestMember_status_check";
