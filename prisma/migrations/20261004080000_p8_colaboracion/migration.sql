-- P8: compartir, colaboración, fondos configurables y relación evento-fondo.
-- La migración es aditiva y no expone tokens ni datos sensibles.
BEGIN;

CREATE TYPE "FundAccessPolicy" AS ENUM ('ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS');

ALTER TABLE "Fund"
  ADD COLUMN "contributionPolicy" "FundAccessPolicy" NOT NULL DEFAULT 'ANY_MEMBER',
  ADD COLUMN "withdrawalPolicy" "FundAccessPolicy" NOT NULL DEFAULT 'MANAGERS',
  ADD COLUMN "closingPolicy" "FundAccessPolicy" NOT NULL DEFAULT 'MANAGERS',
  ADD COLUMN "withdrawalLimitCents" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Fund"
    WHERE "withdrawalLimitCents" IS NOT NULL AND "withdrawalLimitCents" <= 0
  ) THEN
    RAISE EXCEPTION 'P8 preflight: Fund.withdrawalLimitCents contiene limites no positivos';
  END IF;
END $$;

ALTER TABLE "Fund"
  ADD CONSTRAINT "Fund_withdrawalLimitCents_check"
  CHECK ("withdrawalLimitCents" IS NULL OR "withdrawalLimitCents" > 0) NOT VALID;
ALTER TABLE "Fund" VALIDATE CONSTRAINT "Fund_withdrawalLimitCents_check";

CREATE TABLE "EventFund" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "fundId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventFund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventFund_eventId_fundId_key" ON "EventFund"("eventId", "fundId");
CREATE INDEX "EventFund_eventId_idx" ON "EventFund"("eventId");
CREATE INDEX "EventFund_fundId_idx" ON "EventFund"("fundId");
ALTER TABLE "EventFund"
  ADD CONSTRAINT "EventFund_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventFund_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventComment" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventComment_eventId_createdAt_idx" ON "EventComment"("eventId", "createdAt");
CREATE INDEX "EventComment_authorUserId_createdAt_idx" ON "EventComment"("authorUserId", "createdAt");
ALTER TABLE "EventComment"
  ADD CONSTRAINT "EventComment_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventComment_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PublicShareLink" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "eventId" UUID,
  "settlementId" UUID,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicShareLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicShareLink_tokenHash_key" ON "PublicShareLink"("tokenHash");
CREATE INDEX "PublicShareLink_groupId_expiresAt_idx" ON "PublicShareLink"("groupId", "expiresAt");
CREATE INDEX "PublicShareLink_eventId_expiresAt_idx" ON "PublicShareLink"("eventId", "expiresAt");
CREATE INDEX "PublicShareLink_settlementId_expiresAt_idx" ON "PublicShareLink"("settlementId", "expiresAt");
ALTER TABLE "PublicShareLink"
  ADD CONSTRAINT "PublicShareLink_target_check"
  CHECK ((("eventId" IS NOT NULL)::integer + ("settlementId" IS NOT NULL)::integer) = 1) NOT VALID;
ALTER TABLE "PublicShareLink" VALIDATE CONSTRAINT "PublicShareLink_target_check";
ALTER TABLE "PublicShareLink"
  ADD CONSTRAINT "PublicShareLink_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PublicShareLink_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PublicShareLink_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PublicShareLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
