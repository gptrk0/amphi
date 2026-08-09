-- A chat id only ever meant Telegram. A URL means whatever the person pasted into
-- it — Telegram with a placeholder, Discord without one — so the column stops naming
-- one service and the events column stops claiming to be Telegram's.
ALTER TABLE "User" ADD COLUMN "webhookUrl" TEXT;

ALTER TABLE "User" RENAME COLUMN "telegramEvents" TO "notifyEvents";

-- Nothing is carried over: a bare chat id is not a URL, and building one would mean
-- writing the install's bot token into a per-user column where it does not belong.
ALTER TABLE "User" DROP COLUMN "telegramChatId";
