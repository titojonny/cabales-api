-- P9: amplía proveedores y conserva las transacciones OIDC solo por tiempo corto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Account"
    WHERE "provider"::text NOT IN ('PASSWORD')
  ) THEN
    RAISE EXCEPTION 'P9 preflight: Account.provider contiene un proveedor no reconocido';
  END IF;
END $$;

ALTER TYPE "AccountProvider" ADD VALUE IF NOT EXISTS 'GOOGLE';

CREATE TABLE "OAuthState" (
    "id" UUID NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "nonceHash" CHAR(64) NOT NULL,
    "intent" VARCHAR(16) NOT NULL,
    "userId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
CREATE INDEX "OAuthState_userId_expiresAt_idx" ON "OAuthState"("userId", "expiresAt");

ALTER TABLE "OAuthState"
  ADD CONSTRAINT "OAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthState"
  ADD CONSTRAINT "OAuthState_intent_check"
  CHECK ("intent" IN ('login', 'link')) NOT VALID;
ALTER TABLE "OAuthState" VALIDATE CONSTRAINT "OAuthState_intent_check";
