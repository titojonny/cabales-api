-- P5: categorías, caducidad, enlaces temporales, cifrado y bloqueo del módulo Docs.
CREATE TYPE "DocumentCategory" AS ENUM ('IDENTIDAD', 'VIAJE', 'SEGURO', 'VEHICULO', 'SALUD', 'HOGAR', 'FINANZAS', 'OTRO');

ALTER TABLE "Session" ADD COLUMN "documentsUnlockedAt" TIMESTAMP(3);

ALTER TABLE "Document"
  ADD COLUMN "category" "DocumentCategory" NOT NULL DEFAULT 'OTRO',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "expiryNoticeDays" INTEGER[] NOT NULL DEFAULT ARRAY[30, 7],
  ADD COLUMN "lastAccessedAt" TIMESTAMP(3),
  ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "encryptionKeyId" VARCHAR(80),
  ADD COLUMN "encryptionIv" VARCHAR(64),
  ADD COLUMN "encryptionTag" VARCHAR(64),
  ADD COLUMN "wrappedDataKey" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Document" WHERE cardinality("expiryNoticeDays") NOT BETWEEN 1 AND 3) THEN
    RAISE EXCEPTION 'P5 preflight: Document.expiryNoticeDays contiene listas fuera de 1..3';
  END IF;
END $$;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_expiryNoticeDays_valid" CHECK (cardinality("expiryNoticeDays") BETWEEN 1 AND 3) NOT VALID;
ALTER TABLE "Document" VALIDATE CONSTRAINT "Document_expiryNoticeDays_valid";

ALTER TABLE "DocumentAccessGrant" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE TABLE "DocumentPin" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentPin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentPin_documentId_userId_key" ON "DocumentPin"("documentId", "userId");
CREATE INDEX "DocumentPin_userId_createdAt_idx" ON "DocumentPin"("userId", "createdAt");
ALTER TABLE "DocumentPin" ADD CONSTRAINT "DocumentPin_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentPin" ADD CONSTRAINT "DocumentPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentSharedLink" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxAccesses" INTEGER,
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "lastAccessAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentSharedLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentSharedLink_tokenHash_key" ON "DocumentSharedLink"("tokenHash");
CREATE INDEX "DocumentSharedLink_documentId_revokedAt_expiresAt_idx" ON "DocumentSharedLink"("documentId", "revokedAt", "expiresAt");
CREATE INDEX "DocumentSharedLink_expiresAt_idx" ON "DocumentSharedLink"("expiresAt");
ALTER TABLE "DocumentSharedLink" ADD CONSTRAINT "DocumentSharedLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentSharedLink" ADD CONSTRAINT "DocumentSharedLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DocumentSharedLink" WHERE "maxAccesses" IS NOT NULL AND "maxAccesses" < 1) THEN
    RAISE EXCEPTION 'P5 preflight: DocumentSharedLink.maxAccesses debe ser positivo';
  END IF;
END $$;
ALTER TABLE "DocumentSharedLink"
  ADD CONSTRAINT "DocumentSharedLink_maxAccesses_valid" CHECK ("maxAccesses" IS NULL OR "maxAccesses" BETWEEN 1 AND 10000) NOT VALID;
ALTER TABLE "DocumentSharedLink" VALIDATE CONSTRAINT "DocumentSharedLink_maxAccesses_valid";

CREATE TABLE "DocumentModuleLock" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "pinHash" VARCHAR(512),
  "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  "pinLockedUntil" TIMESTAMP(3),
  "unlockTtlMinutes" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentModuleLock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentModuleLock_userId_key" ON "DocumentModuleLock"("userId");
ALTER TABLE "DocumentModuleLock" ADD CONSTRAINT "DocumentModuleLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentWebAuthnCredential" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "credentialId" VARCHAR(512) NOT NULL,
  "publicKey" TEXT NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentWebAuthnCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentWebAuthnCredential_credentialId_key" ON "DocumentWebAuthnCredential"("credentialId");
CREATE INDEX "DocumentWebAuthnCredential_userId_idx" ON "DocumentWebAuthnCredential"("userId");
ALTER TABLE "DocumentWebAuthnCredential" ADD CONSTRAINT "DocumentWebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentWebAuthnChallenge" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "challengeHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentWebAuthnChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentWebAuthnChallenge_userId_type_expiresAt_idx" ON "DocumentWebAuthnChallenge"("userId", "type", "expiresAt");
CREATE INDEX "DocumentWebAuthnChallenge_challengeHash_idx" ON "DocumentWebAuthnChallenge"("challengeHash");
ALTER TABLE "DocumentWebAuthnChallenge" ADD CONSTRAINT "DocumentWebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Document_expiresAt_idx" ON "Document"("expiresAt");
CREATE INDEX "Document_category_createdAt_idx" ON "Document"("category", "createdAt");
CREATE INDEX "Document_lastAccessedAt_idx" ON "Document"("lastAccessedAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DocumentModuleLock" WHERE "unlockTtlMinutes" NOT BETWEEN 1 AND 60) THEN
    RAISE EXCEPTION 'P5 preflight: DocumentModuleLock.unlockTtlMinutes debe estar entre 1 y 60';
  END IF;
END $$;
ALTER TABLE "DocumentModuleLock"
  ADD CONSTRAINT "DocumentModuleLock_unlockTtlMinutes_valid" CHECK ("unlockTtlMinutes" BETWEEN 1 AND 60) NOT VALID;
ALTER TABLE "DocumentModuleLock" VALIDATE CONSTRAINT "DocumentModuleLock_unlockTtlMinutes_valid";
