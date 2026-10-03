-- Puente aditivo para una base creada con `prisma db push` antes de
-- 20260926110000_initial_schema. Ejecutar solo si el esquema coincide con el
-- subconjunto estricto documentado en README.md.

BEGIN;

DO $$
BEGIN
    IF to_regtype('public."PrivacyRequestType"') IS NULL THEN
        CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'OBJECTION', 'PORTABILITY');
    END IF;

    IF to_regtype('public."PrivacyRequestStatus"') IS NULL THEN
        CREATE TYPE "PrivacyRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');
    END IF;
END
$$;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PrivacyRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(1000),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_tokenHash_key"
    ON "EmailVerificationToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_userId_expiresAt_idx"
    ON "EmailVerificationToken"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_expiresAt_idx"
    ON "EmailVerificationToken"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key"
    ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_expiresAt_idx"
    ON "PasswordResetToken"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx"
    ON "PasswordResetToken"("expiresAt");

CREATE INDEX IF NOT EXISTS "PrivacyRequest_userId_status_createdAt_idx"
    ON "PrivacyRequest"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PrivacyRequest_status_createdAt_idx"
    ON "PrivacyRequest"("status", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public."EmailVerificationToken"'::regclass
          AND conname = 'EmailVerificationToken_userId_fkey'
    ) THEN
        ALTER TABLE "EmailVerificationToken"
            ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public."PasswordResetToken"'::regclass
          AND conname = 'PasswordResetToken_userId_fkey'
    ) THEN
        ALTER TABLE "PasswordResetToken"
            ADD CONSTRAINT "PasswordResetToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public."PrivacyRequest"'::regclass
          AND conname = 'PrivacyRequest_userId_fkey'
    ) THEN
        ALTER TABLE "PrivacyRequest"
            ADD CONSTRAINT "PrivacyRequest_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
DECLARE
    v_missing TEXT := '';
BEGIN
    IF to_regtype('public."PrivacyRequestType"') IS NULL THEN
        v_missing := v_missing || ' PrivacyRequestType';
    END IF;
    IF to_regtype('public."PrivacyRequestStatus"') IS NULL THEN
        v_missing := v_missing || ' PrivacyRequestStatus';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name = 'emailVerifiedAt'
    ) THEN
        v_missing := v_missing || ' User.emailVerifiedAt';
    END IF;

    IF to_regclass('public."EmailVerificationToken"') IS NULL THEN
        v_missing := v_missing || ' EmailVerificationToken';
    END IF;
    IF to_regclass('public."PasswordResetToken"') IS NULL THEN
        v_missing := v_missing || ' PasswordResetToken';
    END IF;
    IF to_regclass('public."PrivacyRequest"') IS NULL THEN
        v_missing := v_missing || ' PrivacyRequest';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."EmailVerificationToken"'::regclass
          AND conname = 'EmailVerificationToken_pkey' AND contype = 'p'
    ) THEN
        v_missing := v_missing || ' EmailVerificationToken_pkey';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."PasswordResetToken"'::regclass
          AND conname = 'PasswordResetToken_pkey' AND contype = 'p'
    ) THEN
        v_missing := v_missing || ' PasswordResetToken_pkey';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."PrivacyRequest"'::regclass
          AND conname = 'PrivacyRequest_pkey' AND contype = 'p'
    ) THEN
        v_missing := v_missing || ' PrivacyRequest_pkey';
    END IF;

    IF to_regclass('public."EmailVerificationToken_tokenHash_key"') IS NULL THEN
        v_missing := v_missing || ' EmailVerificationToken_tokenHash_key';
    END IF;
    IF to_regclass('public."EmailVerificationToken_userId_expiresAt_idx"') IS NULL THEN
        v_missing := v_missing || ' EmailVerificationToken_userId_expiresAt_idx';
    END IF;
    IF to_regclass('public."EmailVerificationToken_expiresAt_idx"') IS NULL THEN
        v_missing := v_missing || ' EmailVerificationToken_expiresAt_idx';
    END IF;
    IF to_regclass('public."PasswordResetToken_tokenHash_key"') IS NULL THEN
        v_missing := v_missing || ' PasswordResetToken_tokenHash_key';
    END IF;
    IF to_regclass('public."PasswordResetToken_userId_expiresAt_idx"') IS NULL THEN
        v_missing := v_missing || ' PasswordResetToken_userId_expiresAt_idx';
    END IF;
    IF to_regclass('public."PasswordResetToken_expiresAt_idx"') IS NULL THEN
        v_missing := v_missing || ' PasswordResetToken_expiresAt_idx';
    END IF;
    IF to_regclass('public."PrivacyRequest_userId_status_createdAt_idx"') IS NULL THEN
        v_missing := v_missing || ' PrivacyRequest_userId_status_createdAt_idx';
    END IF;
    IF to_regclass('public."PrivacyRequest_status_createdAt_idx"') IS NULL THEN
        v_missing := v_missing || ' PrivacyRequest_status_createdAt_idx';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."EmailVerificationToken"'::regclass
          AND conname = 'EmailVerificationToken_userId_fkey' AND contype = 'f'
    ) THEN
        v_missing := v_missing || ' EmailVerificationToken_userId_fkey';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."PasswordResetToken"'::regclass
          AND conname = 'PasswordResetToken_userId_fkey' AND contype = 'f'
    ) THEN
        v_missing := v_missing || ' PasswordResetToken_userId_fkey';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public."PrivacyRequest"'::regclass
          AND conname = 'PrivacyRequest_userId_fkey' AND contype = 'f'
    ) THEN
        v_missing := v_missing || ' PrivacyRequest_userId_fkey';
    END IF;

    IF v_missing <> '' THEN
        RAISE EXCEPTION 'El puente no pudo verificar todos los objetos requeridos:%', v_missing;
    END IF;
END
$$;

COMMIT;
