-- A device is no longer the address it happens to have.
--
-- The endpoint moves. A browser may renew a push subscription with nobody asking, and
-- since a refresh is deliberately not allowed to create a row — that is what makes
-- forgetting a device from another one stick — a device keyed by its endpoint went silent
-- the moment the browser renewed it, until somebody pressed the switch again.
--
-- The event the specification offers for exactly this, `pushsubscriptionchange`, is not the
-- way out: Chrome only began firing it in 138 and iOS does not support it at all, which is
-- the one platform this feature exists for. So the identity moves into something neither
-- the push service nor the browser gets to change: a key the page makes once and keeps in
-- its own storage.
--
-- **The two cases this tells apart**, which were indistinguishable before:
--
-- - the browser renewed its subscription — same key, new endpoint, the row follows;
-- - the device was forgotten from somewhere else — no row at all, so nothing to find, and
--   the only way back is its owner pressing the switch on it.
--
-- The existing rows keep working. They are given a key nothing knows, and the first page
-- load from the browser that owns one arrives with its own new key and the matching
-- endpoint, which `refreshDevice` adopts into the row. Nobody has to turn anything on
-- again, and a row that was deleted in the meantime is still not there to be adopted.
ALTER TABLE "PushDevice" ADD COLUMN "deviceKey" TEXT;

UPDATE "PushDevice" SET "deviceKey" = gen_random_uuid()::text WHERE "deviceKey" IS NULL;

ALTER TABLE "PushDevice" ALTER COLUMN "deviceKey" SET NOT NULL;

DROP INDEX "PushDevice_endpoint_key";

CREATE UNIQUE INDEX "PushDevice_deviceKey_key" ON "PushDevice"("deviceKey");

CREATE INDEX "PushDevice_endpoint_idx" ON "PushDevice"("endpoint");
