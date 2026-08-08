-- CreateEnum
CREATE TYPE "BlockReason" AS ENUM ('STALLED', 'BAD_PAYLOAD');

-- CreateTable
CREATE TABLE "BlockedRelease" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "reason" "BlockReason" NOT NULL,
    "detail" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "BlockedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedRelease_title_key" ON "BlockedRelease"("title");

-- CreateIndex
CREATE INDEX "BlockedRelease_expiresAt_idx" ON "BlockedRelease"("expiresAt");

