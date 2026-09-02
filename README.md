# Discord Koek

An [Alt1 Toolkit](https://runeapps.org/alt1) plugin that watches your RuneScape 3
chatbox and posts **your** drops to a Discord channel.

## How it works

```
Alt1 chatbox reader  ->  matcher ("<your RSN> ... has received ...")
      ->  de-dup (90s window)  ->  GE price (Weird Gloop API)
      ->  screenshot (optional)  ->  Discord webhook
```

Everything runs locally in the Alt1 app. There is no server.

## Prerequisites

- [Node.js](https://nodejs.org) 18+ (for building only)
- [Alt1 Toolkit](https://runeapps.org/alt1) installed
- RuneScape 3 running via the official client / NXT
- A Discord **webhook URL** for the target channel
  (Channel → Edit → Integrations → Webhooks → New Webhook → Copy URL)

## Build / run

```bash
npm install
npm run dev        # watch + dev server on http://localhost:5173
# or
npm run build      # one-off build into dist/

npm run typecheck  # tsc --noEmit
npm run check       # run the chat-line matcher against sample broadcasts
```

### Add it to Alt1 (development)

With `npm run dev` running, open this URL (Alt1 registers the `alt1://` scheme):

```
alt1://addapp/http://localhost:5173/appconfig.json
```

or in Alt1: **Add App → Manual → `http://localhost:5173/appconfig.json`**.

## In-game setup

- Keep a chat tab where your drop broadcasts appear (game/clan/broadcast messages on).
- Chat timestamps are **not required** — de-dup does not depend on them.
- Grant the app the **pixel** permission when Alt1 asks.

## Plugin setup

1. Open the app in Alt1.
2. Enter **Your RuneScape name** exactly as it appears in game.
3. Paste your **Discord webhook URL**.
4. Optionally tick **Attach a screenshot**.
5. **Save**, then **Send test** to confirm the webhook works.

## Distribution (later)

Build and publish `dist/` to GitHub Pages, then friends add:

```
alt1://addapp/https://<you>.github.io/<repo>/appconfig.json
```

Each friend enters their own RSN and (their own or a shared) webhook URL.

## Scope of v1

- Trigger: any chat line containing your RSN **and** `has received`.
- Embed: player name, item (linked to the RS Wiki), quantity, GE value, optional
  screenshot, timestamp.
- Not in v1: boss name / drop rarity, Google Sheet logging, level-ups / quests /
  achievements. All planned as additions to the same pipeline.
