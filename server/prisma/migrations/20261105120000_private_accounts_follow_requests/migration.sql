ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPrivate" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
    CREATE TYPE "FollowRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "FollowRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "FollowRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FollowRequest_requesterId_targetId_key"
    ON "FollowRequest"("requesterId", "targetId");
CREATE INDEX IF NOT EXISTS "FollowRequest_targetId_status_createdAt_idx"
    ON "FollowRequest"("targetId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "FollowRequest_requesterId_status_createdAt_idx"
    ON "FollowRequest"("requesterId", "status", "createdAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowRequest_requesterId_fkey' AND conrelid = '"FollowRequest"'::regclass) THEN
        ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_requesterId_fkey"
            FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowRequest_targetId_fkey' AND conrelid = '"FollowRequest"'::regclass) THEN
        ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_targetId_fkey"
            FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_REQUEST_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_REQUEST_REJECTED';
