-- Additive changes required for verified Google profiles and Cloudinary media.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "TweetMedia" (
    "id" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TweetMedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TweetMedia_tweetId_order_idx" ON "TweetMedia"("tweetId", "order");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TweetMedia_tweetId_fkey' AND conrelid = '"TweetMedia"'::regclass) THEN
        ALTER TABLE "TweetMedia" ADD CONSTRAINT "TweetMedia_tweetId_fkey"
            FOREIGN KEY ("tweetId") REFERENCES "Tweet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PendingUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT,
    "folder" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'image',
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PendingUpload" ADD COLUMN IF NOT EXISTS "url" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PendingUpload_publicId_key" ON "PendingUpload"("publicId");
CREATE INDEX IF NOT EXISTS "PendingUpload_userId_status_idx" ON "PendingUpload"("userId", "status");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingUpload_userId_fkey' AND conrelid = '"PendingUpload"'::regclass) THEN
        ALTER TABLE "PendingUpload" ADD CONSTRAINT "PendingUpload_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
