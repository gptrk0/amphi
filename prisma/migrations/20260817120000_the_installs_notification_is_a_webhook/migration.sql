-- The install's own notification channel becomes a webhook URL, which is what every
-- account has had since 2026-08-09. It was `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` +
-- `TELEGRAM_API_URL`: three fields that named a service, and only that service could ever
-- use them. A URL is one field, and Telegram, Discord and anything else are all just URLs.
--
-- **The URL is built from what is already there**, so an install whose notifications work
-- keeps working through this migration without anybody retyping a token. The shape is the
-- one the account page has offered as its Telegram example all along, and `{message}` is
-- what makes `callWebhook` send it as a GET with the text in the query string.
--
-- Only when there is something to build from: a token and a chat id, both non-empty. An
-- install that never set Telegram up gets no row and stays "not configured" — which is what
-- it was. The bot api url is joined in optionally, because it has a default and an install
-- that never touched it has no row for it.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT
    'NOTIFY_WEBHOOK_URL',
    coalesce(nullif(rtrim(api."value", '/'), ''), 'https://api.telegram.org')
        || '/bot' || token."value"
        || '/sendMessage?chat_id=' || chat."value"
        || '&text={message}',
    now()
FROM "Setting" AS token
JOIN "Setting" AS chat ON chat."key" = 'TELEGRAM_CHAT_ID' AND chat."value" <> ''
LEFT JOIN "Setting" AS api ON api."key" = 'TELEGRAM_API_URL'
WHERE token."key" = 'TELEGRAM_BOT_TOKEN' AND token."value" <> ''
ON CONFLICT ("key") DO NOTHING;

-- The events carry over as they are — same values, same "unset sends nothing, `*` sends
-- everything" rule, same default. An install that never edited them has no row here either,
-- and `NOTIFY_EVENTS` has the same default `TELEGRAM_EVENTS` had.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'NOTIFY_EVENTS', "value", now()
FROM "Setting"
WHERE "key" = 'TELEGRAM_EVENTS'
ON CONFLICT ("key") DO NOTHING;

-- Nothing reads these any more, and a stale token left in the table is a secret kept for
-- no reason.
DELETE FROM "Setting"
WHERE "key" IN ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_EVENTS', 'TELEGRAM_API_URL');
