-- Where a notification goes when the answer is "this phone", with no second app in the
-- middle. A webhook needs a service that already has the person's attention — Telegram,
-- Discord, ntfy — and all three are somebody else's app to install. A web push goes to
-- the browser that is already running the page, which on a home screen is the app itself.
--
-- One row is one subscription, not one person and not one device: it belongs to a service
-- worker, so the same phone with the app installed and the site open in a tab is two of
-- them, and a browser whose storage was cleared is a new one. `endpoint` is the address
-- the push service gave out and the only identity there is, hence the unique index;
-- `p256dh` and `auth` are the keys the message is sealed with before it leaves here.
--
-- Nothing is migrated into this table. A subscription cannot be created from the server
-- side — only a browser can make one, by asking its user — so the table starts empty on
-- every install, including the ones that have had notifications working for months.
CREATE TABLE "PushDevice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_endpoint_key" ON "PushDevice"("endpoint");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
