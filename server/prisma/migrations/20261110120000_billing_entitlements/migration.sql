-- Additive billing, payment audit and AI credit-ledger schema. Existing records are retained.
ALTER TABLE "ConversationParticipant" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);
UPDATE "ConversationParticipant" AS participant
SET "lastReadAt" = CASE WHEN participant."hasReadLatest" THEN conversation."updatedAt" ELSE participant."joinedAt" END
FROM "Conversation" AS conversation
WHERE participant."conversationId" = conversation."id" AND participant."lastReadAt" IS NULL;

ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'PLUS';
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'PRO';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'HALTED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE "Subscription"
    ALTER COLUMN "tier" SET DEFAULT 'FREE';

CREATE TABLE IF NOT EXISTS "RazorpaySubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "razorpaySubscriptionId" TEXT NOT NULL,
    "razorpayPlanId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RazorpaySubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RazorpaySubscription_razorpaySubscriptionId_key"
    ON "RazorpaySubscription"("razorpaySubscriptionId");
CREATE INDEX IF NOT EXISTS "RazorpaySubscription_userId_status_createdAt_idx"
    ON "RazorpaySubscription"("userId", "status", "createdAt");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RazorpaySubscription_userId_fkey' AND conrelid = '"RazorpaySubscription"'::regclass) THEN
        ALTER TABLE "RazorpaySubscription" ADD CONSTRAINT "RazorpaySubscription_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BillingPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "razorpaySubscriptionRowId" TEXT,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpaySubscriptionId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingPayment_razorpayPaymentId_key"
    ON "BillingPayment"("razorpayPaymentId");
CREATE INDEX IF NOT EXISTS "BillingPayment_userId_createdAt_idx"
    ON "BillingPayment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BillingPayment_razorpaySubscriptionId_idx"
    ON "BillingPayment"("razorpaySubscriptionId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingPayment_userId_fkey' AND conrelid = '"BillingPayment"'::regclass) THEN
        ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingPayment_razorpaySubscriptionRowId_fkey' AND conrelid = '"BillingPayment"'::regclass) THEN
        ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_razorpaySubscriptionRowId_fkey"
            FOREIGN KEY ("razorpaySubscriptionRowId") REFERENCES "RazorpaySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedWebhookEvent_eventId_key"
    ON "ProcessedWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "ProcessedWebhookEvent_event_receivedAt_idx"
    ON "ProcessedWebhookEvent"("event", "receivedAt");

CREATE TABLE IF NOT EXISTS "AiUsagePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiUsagePeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiUsagePeriod_userId_periodStart_key"
    ON "AiUsagePeriod"("userId", "periodStart");
CREATE INDEX IF NOT EXISTS "AiUsagePeriod_userId_periodEnd_idx"
    ON "AiUsagePeriod"("userId", "periodEnd");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsagePeriod_userId_fkey' AND conrelid = '"AiUsagePeriod"'::regclass) THEN
        ALTER TABLE "AiUsagePeriod" ADD CONSTRAINT "AiUsagePeriod_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usagePeriodId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_idempotencyKey_key"
    ON "CreditTransaction"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditTransaction_userId_createdAt_idx"
    ON "CreditTransaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditTransaction_usagePeriodId_createdAt_idx"
    ON "CreditTransaction"("usagePeriodId", "createdAt");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransaction_userId_fkey' AND conrelid = '"CreditTransaction"'::regclass) THEN
        ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransaction_usagePeriodId_fkey' AND conrelid = '"CreditTransaction"'::regclass) THEN
        ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_usagePeriodId_fkey"
            FOREIGN KEY ("usagePeriodId") REFERENCES "AiUsagePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
