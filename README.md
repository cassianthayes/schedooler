# MAX schedule relay

Mirrors the schedule photo from the public MAX channel
[`МАОУ "Флагман"`](https://max.ru/id5903158943_gos) to the Telegram channel
`@scheduleflagman`.

Public MAX channels expose their latest posts as SvelteKit data at
`https://max.ru/<channel>/__data.json`, so no MAX account or browser is needed.
Every minute between 07:00 and 20:59 Moscow, the Worker keeps posts whose text
contains `расписание` and that have exactly one photo, downloads the image at
full width (`fn=w_1440`), and sends it to Telegram. Post URLs are stored in D1
so each post is sent once; edits and deletions are ignored. The first run
records the current posts without sending them.

## Setup

```bash
npx wrangler d1 create max-relay --location=eeur
npx wrangler d1 execute max-relay --file=schema.sql --remote
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID     # e.g. @scheduleflagman
npx wrangler deploy
```

The bot must be an admin of the target Telegram channel. To use another MAX
channel, change `MAX_CHANNEL_URL` in `wrangler.toml`.

## Test locally

```bash
npx wrangler d1 execute max-relay --file=schema.sql --local
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*+4-17+*+*+*"
```

The first local run only records the current posts as a baseline.

`wrangler.toml` holds the cron schedule, D1 binding, and channel URL.
`schema.sql` creates the `relayed` table and removes the old `seen`/`state`
tables.
