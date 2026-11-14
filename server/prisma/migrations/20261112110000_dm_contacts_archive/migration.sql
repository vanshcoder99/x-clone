-- Additive messaging updates. Existing conversations and message history are retained.
ALTER TABLE "Conversation"
ADD COLUMN "directKey" TEXT;

CREATE UNIQUE INDEX "Conversation_directKey_key"
ON "Conversation"("directKey");

ALTER TABLE "ConversationParticipant"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ConversationParticipant_userId_archivedAt_idx"
ON "ConversationParticipant"("userId", "archivedAt");
