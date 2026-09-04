CREATE TYPE "TicketMeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "CalendarSyncStatus" AS ENUM ('NOT_SYNCED', 'PENDING', 'SYNCED', 'FAILED');
CREATE TYPE "MeetingAttendeeType" AS ENUM ('REQUIRED', 'OPTIONAL');
CREATE TYPE "MeetingAttendeeSource" AS ENUM ('REQUESTER', 'CONVERSATION_PARTICIPANT', 'INTERNAL_USER', 'CONTACT', 'MANUAL');

CREATE TABLE "ticket_meetings" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "organizerUserId" UUID,
  "createdByUserId" UUID,
  "updatedByUserId" UUID,
  "title" TEXT NOT NULL,
  "agenda" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "location" TEXT,
  "isOnlineMeeting" BOOLEAN NOT NULL DEFAULT false,
  "status" "TicketMeetingStatus" NOT NULL DEFAULT 'DRAFT',
  "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
  "organizerCalendarEmail" TEXT,
  "providerEventId" TEXT,
  "transactionId" UUID NOT NULL,
  "providerChangeKey" TEXT,
  "providerICalUId" TEXT,
  "providerWebLink" TEXT,
  "onlineMeetingJoinUrl" TEXT,
  "syncError" TEXT,
  "syncAttemptedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_meetings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_meeting_attendees" (
  "id" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "userId" UUID,
  "contactId" UUID,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "type" "MeetingAttendeeType" NOT NULL DEFAULT 'REQUIRED',
  "source" "MeetingAttendeeSource" NOT NULL DEFAULT 'MANUAL',
  "responseStatus" TEXT,
  "responseAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_meeting_attendees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_activity" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "userId" UUID,
  "ticketMeetingId" UUID,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_meetings_transactionId_key" ON "ticket_meetings"("transactionId");
CREATE INDEX "ticket_meetings_organizationId_startAt_idx" ON "ticket_meetings"("organizationId", "startAt");
CREATE INDEX "ticket_meetings_ticketId_startAt_idx" ON "ticket_meetings"("ticketId", "startAt");
CREATE INDEX "ticket_meetings_organizerUserId_startAt_idx" ON "ticket_meetings"("organizerUserId", "startAt");
CREATE INDEX "ticket_meetings_syncStatus_syncAttemptedAt_idx" ON "ticket_meetings"("syncStatus", "syncAttemptedAt");
CREATE INDEX "ticket_meetings_providerEventId_idx" ON "ticket_meetings"("providerEventId");
CREATE UNIQUE INDEX "ticket_meeting_attendees_meetingId_email_key" ON "ticket_meeting_attendees"("meetingId", "email");
CREATE INDEX "ticket_meeting_attendees_userId_idx" ON "ticket_meeting_attendees"("userId");
CREATE INDEX "ticket_meeting_attendees_contactId_idx" ON "ticket_meeting_attendees"("contactId");
CREATE INDEX "ticket_activity_ticketId_createdAt_idx" ON "ticket_activity"("ticketId", "createdAt");
CREATE INDEX "ticket_activity_userId_idx" ON "ticket_activity"("userId");
CREATE INDEX "ticket_activity_ticketMeetingId_idx" ON "ticket_activity"("ticketMeetingId");

ALTER TABLE "ticket_meetings" ADD CONSTRAINT "ticket_meetings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_meetings" ADD CONSTRAINT "ticket_meetings_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_meetings" ADD CONSTRAINT "ticket_meetings_organizerUserId_fkey" FOREIGN KEY ("organizerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_meetings" ADD CONSTRAINT "ticket_meetings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_meetings" ADD CONSTRAINT "ticket_meetings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_meeting_attendees" ADD CONSTRAINT "ticket_meeting_attendees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ticket_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_meeting_attendees" ADD CONSTRAINT "ticket_meeting_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_meeting_attendees" ADD CONSTRAINT "ticket_meeting_attendees_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticketMeetingId_fkey" FOREIGN KEY ("ticketMeetingId") REFERENCES "ticket_meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "name", "description", "createdAt", "updatedAt")
VALUES
  (md5('permission:ticket_meetings.view')::uuid, 'ticket_meetings.view', 'Allows viewing ticket meetings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('permission:ticket_meetings.create')::uuid, 'ticket_meetings.create', 'Allows creating and scheduling ticket meetings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('permission:ticket_meetings.update')::uuid, 'ticket_meetings.update', 'Allows updating and completing ticket meetings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('permission:ticket_meetings.cancel')::uuid, 'ticket_meetings.cancel', 'Allows cancelling ticket meetings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE
SET "description" = EXCLUDED."description",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT md5('role_permission:' || r."id"::text || ':' || p."id"::text)::uuid, r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager', 'Technician')
  AND p."name" IN ('ticket_meetings.view', 'ticket_meetings.create', 'ticket_meetings.update', 'ticket_meetings.cancel')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT md5('role_permission:' || r."id"::text || ':' || p."id"::text)::uuid, r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."name" = 'ticket_meetings.view'
WHERE r."name" = 'Auditor'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
