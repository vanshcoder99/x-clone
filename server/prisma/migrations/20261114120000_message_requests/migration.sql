CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'PENDING');

ALTER TABLE "Conversation"
ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "requestedById" TEXT;

CREATE INDEX "Conversation_status_requestedById_idx"
ON "Conversation"("status", "requestedById");
