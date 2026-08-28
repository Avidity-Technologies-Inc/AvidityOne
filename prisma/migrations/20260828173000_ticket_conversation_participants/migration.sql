CREATE TABLE "ticket_conversation_participants" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "userId" UUID,
  "contactId" UUID,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "addedById" UUID,
  "removedById" UUID,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ticket_conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_conversation_participants_ticketId_email_key"
ON "ticket_conversation_participants"("ticketId", "email");

CREATE INDEX "ticket_conversation_participants_ticketId_isActive_idx"
ON "ticket_conversation_participants"("ticketId", "isActive");

CREATE INDEX "ticket_conversation_participants_userId_idx"
ON "ticket_conversation_participants"("userId");

CREATE INDEX "ticket_conversation_participants_contactId_idx"
ON "ticket_conversation_participants"("contactId");

ALTER TABLE "ticket_conversation_participants"
ADD CONSTRAINT "ticket_conversation_participants_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_participants"
ADD CONSTRAINT "ticket_conversation_participants_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_participants"
ADD CONSTRAINT "ticket_conversation_participants_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_participants"
ADD CONSTRAINT "ticket_conversation_participants_addedById_fkey"
FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_participants"
ADD CONSTRAINT "ticket_conversation_participants_removedById_fkey"
FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
