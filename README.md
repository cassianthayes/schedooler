# schedooler

Mirror schedule from MAX to Telegram.

## How it works

MAX exposes public channel posts as SvelteKit data at
`https://max.ru/<channel>/__data.json`, so no account is needed. Every minute
from 07:00 to 20:59 Moscow the Worker forwards new posts whose text contains
`расписание` and that have one photo, at full width (`fn=w_1440`) with the text
as caption. Posts are deduplicated by URL in D1, so edits are ignored and the
first run only records a baseline.

## Failure alerts

A failed run, or one with posts that could not be sent (retried on later runs),
sends one warning to `TELEGRAM_ALERT_USER_ID`; an outage alerts about once a
minute.

## Setup

```bash
npx wrangler d1 create max-relay --location=eeur
npx wrangler d1 execute max-relay --file=schema.sql --remote
npx wrangler secret put TELEGRAM_BOT_TOKEN     # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID       # target channel, e.g. @channel
npx wrangler secret put TELEGRAM_ALERT_USER_ID # optional user id for alerts
npx wrangler secret put MAX_CHANNEL_URL        # e.g. https://max.ru/<channel>
npx wrangler deploy
```

The bot must be able to send messages in the target channel, and the alert
user must have started a chat with the bot.

## Local development

```bash
cp .env.example .env
npx wrangler d1 execute max-relay --file=schema.sql --local
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*+4-17+*+*+*"
```

`wrangler dev` reads `.env`, so local runs call the real MAX and Telegram APIs.
