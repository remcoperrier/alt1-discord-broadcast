# Discord Koek

An [Alt1 Toolkit](https://runeapps.org/alt1) app that watches your RuneScape 3
chatbox and posts **your own** drops, level-ups and achievements to a Discord
channel — like RuneLite's Dink, for RS3.

## Install (for friends — no build needed)

1. Install [Alt1 Toolkit](https://runeapps.org/alt1).
2. Add the app — click this link, or paste the URL into Alt1 → **Add App**:

   ```
   alt1://addapp/https://remcoperrier.github.io/alt1-discord-broadcast/appconfig.json
   ```

3. Grant the **pixel** permission when Alt1 asks.
4. In the app: enter **Your RuneScape name** (exactly as in game), paste a
   **Discord webhook URL** (Channel → Edit → Integrations → Webhooks → New
   Webhook → Copy URL), pick which categories to broadcast, **Save**, then
   **Send test**.

Everything runs locally in the Alt1 app — no server, and your webhook never
leaves your machine.

## What it broadcasts

| Category | Example source line |
|---|---|
| Drops & pets | `<RSN> has received a Zamorak hilt drop!` |
| Level-ups | `You've just advanced a Defence level! You have reached level 104.` |
| 99 / 120 / XP | `<RSN> has achieved 99 Cooking!` · `Well done! You've achieved 20,000,000 XP in Defence!` |
| Titles | `<RSN> has unlocked the 'Jack of All Blades' title!` |
| Quests | `You have completed <Quest>.` |
| Area tasks | `…completed all of the Easy Desert achievements` |
| Clue caskets | `<RSN> completed a Treasure Trail and received <item>!` |

Drops link the item to the RS Wiki and show GE value (Weird Gloop API);
level-ups link the skill; quests / area tasks link their wiki page.

## Chat setup

- Keep a chat tab where your broadcasts appear (game / clan / broadcast on).
- Use the **default chat text size** (Alt1's OCR fonts only cover that).
- Chat timestamps are optional — de-dup does not rely on them.

## Development

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev        # watch + dev server on http://localhost:5173
npm run build      # one-off build into dist/
npm run typecheck  # tsc --noEmit
npm run check      # run the matcher against sample chat lines
```

Add the dev build to Alt1:

```
alt1://addapp/http://localhost:5173/appconfig.json
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes `dist/` to GitHub Pages at
`https://remcoperrier.github.io/alt1-discord-broadcast/`. Alt1 re-checks
`configUrl` on reload, so a push reaches every friend.

One-time repo setup: **Settings → Pages → Source: GitHub Actions**.

## Architecture

```
Alt1 chatbox reader ─► row-rescue OCR for stalled lines
  ─► matcher (drop | levelup | xp | 99/120 | feat | title | quest | areatask | clue)
  ─► category gate + de-dup (90s, per-kind semantic key)
  ─► GE price (drops/clues) + screenshot (optional)
  ─► per-kind embed ─► Discord webhook
```
