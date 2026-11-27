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
npx wrangler secret put TELEGRAM_ALERT_USER_ID  # numeric id for failure warnings
npx wrangler secret put MAX_CHANNEL_URL      # e.g. https://max.ru/id5903158943_gos
npx wrangler deploy
```

The bot must be an admin of the target Telegram channel. `MAX_CHANNEL_URL`
accepts any public MAX channel; the run fails (and alerts) when it is missing.

Failures are reported through the same bot: a run that throws, or one where
some posts could not be sent, sends a single warning to
`TELEGRAM_ALERT_USER_ID`. That user must have started a chat with the bot;
without the secret, failures are only logged.

## Test locally

Copy `.env.example` to `.env` and fill in the values first; `wrangler dev`
reads it for local runs.

```bash
npx wrangler d1 execute max-relay --file=schema.sql --local
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*+4-17+*+*+*"
```

The first local run only records the current posts as a baseline.

`wrangler.toml` holds the cron schedule and D1 binding; all API credentials
and the MAX channel URL are Worker secrets. `schema.sql` creates the `relayed`
table and removes the old `seen`/`state` tables.
