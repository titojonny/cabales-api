-- P3: edición/cancelación de eventos, RSVP, recordatorios y ejecuciones idempotentes.

CREATE TYPE "EventParticipantRsvpStatus" AS ENUM ('PENDING', 'GOING', 'MAYBE', 'DECLINED');
CREATE TYPE "ScheduledJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "Event"
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "locationName" VARCHAR(160),
  ADD COLUMN "locationAddress" VARCHAR(500),
  ADD COLUMN "mapsUrl" VARCHAR(2048),
  ADD COLUMN "timeZone" VARCHAR(80);

ALTER TABLE "EventParticipant"
  ADD COLUMN "rsvpStatus" "EventParticipantRsvpStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "respondedAt" TIMESTAMP(3);

CREATE TABLE "EventReminder" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledJobRun" (
    "id" UUID NOT NULL,
    "jobKey" VARCHAR(200) NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventReminder_eventId_minutesBefore_key"
  ON "EventReminder"("eventId", "minutesBefore");
CREATE INDEX "EventReminder_eventId_enabled_idx"
  ON "EventReminder"("eventId", "enabled");
CREATE UNIQUE INDEX "ScheduledJobRun_jobKey_key"
  ON "ScheduledJobRun"("jobKey");
CREATE INDEX "ScheduledJobRun_status_updatedAt_idx"
  ON "ScheduledJobRun"("status", "updatedAt");
CREATE INDEX "ScheduledJobRun_startedAt_idx"
  ON "ScheduledJobRun"("startedAt");

ALTER TABLE "EventReminder"
  ADD CONSTRAINT "EventReminder_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preflight explícito antes de validar las restricciones nuevas.
DO $$
DECLARE
    v_count BIGINT;
    v_violations TEXT := '';
BEGIN
    SELECT COUNT(*) INTO v_count FROM "Event"
    WHERE "endsAt" IS NOT NULL AND "endsAt" < "startsAt";
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Event_endsAt_after_startsAt: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "Event"
    WHERE "mapsUrl" IS NOT NULL AND "mapsUrl" NOT LIKE 'https://%';
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- Event_mapsUrl_https: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "EventReminder"
    WHERE "minutesBefore" < 1 OR "minutesBefore" > 525600;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- EventReminder_minutesBefore_range: %s fila(s)', v_count);
    END IF;

    SELECT COUNT(*) INTO v_count FROM "ScheduledJobRun"
    WHERE "attempts" < 0;
    IF v_count > 0 THEN
        v_violations := v_violations || format(E'\n- ScheduledJobRun_attempts_nonnegative: %s fila(s)', v_count);
    END IF;

    IF v_violations <> '' THEN
        RAISE EXCEPTION USING MESSAGE = format(
            'No se pueden validar las restricciones P3:%s', v_violations
        );
    END IF;
END
$$;

ALTER TABLE "Event" ADD CONSTRAINT "Event_endsAt_after_startsAt"
  CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt") NOT VALID;
ALTER TABLE "Event" ADD CONSTRAINT "Event_mapsUrl_https"
  CHECK ("mapsUrl" IS NULL OR "mapsUrl" LIKE 'https://%') NOT VALID;
ALTER TABLE "EventReminder" ADD CONSTRAINT "EventReminder_minutesBefore_range"
  CHECK ("minutesBefore" BETWEEN 1 AND 525600) NOT VALID;
ALTER TABLE "ScheduledJobRun" ADD CONSTRAINT "ScheduledJobRun_attempts_nonnegative"
  CHECK ("attempts" >= 0) NOT VALID;

ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_endsAt_after_startsAt";
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_mapsUrl_https";
ALTER TABLE "EventReminder" VALIDATE CONSTRAINT "EventReminder_minutesBefore_range";
ALTER TABLE "ScheduledJobRun" VALIDATE CONSTRAINT "ScheduledJobRun_attempts_nonnegative";
