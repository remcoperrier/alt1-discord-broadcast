import * as a1lib from "alt1/base";
import * as ChatboxModule from "alt1/chatbox";
import * as OCR from "alt1/ocr";

// `alt1/chatbox` ships as a CJS/UMD bundle with a compiled `export default`.
// Under esbuild's Node-style interop the default import resolves to the whole
// `module.exports`, so the real class sits one level deeper. Resolve it here
// with fallbacks so this works regardless of how the module is interpreted.
type ChatBoxReaderCtor = typeof import("alt1/chatbox").default;
const chatboxMod = ChatboxModule as unknown as {
  default?: { default?: ChatBoxReaderCtor; defaultcolors?: number[][] } & ChatBoxReaderCtor;
  defaultcolors?: number[][];
};
const ChatBoxReader: ChatBoxReaderCtor =
  chatboxMod.default?.default ?? (chatboxMod.default as ChatBoxReaderCtor) ??
  (ChatboxModule as unknown as ChatBoxReaderCtor);
const defaultcolors: number[][] =
  chatboxMod.defaultcolors ?? chatboxMod.default?.defaultcolors ?? [];

import { loadSettings, saveSettings, type Settings } from "./settings";
import { parseLine, dedupKeys } from "./matcher";
import { Dedup } from "./dedup";
import { getPrice } from "./prices";
import { postDrop } from "./discord";
import { captureScreenshot } from "./screenshot";

// --- Alt1 wiring -------------------------------------------------------------

a1lib.identifyApp("./appconfig.json");

/** The Alt1 host injects a global `alt1` object; typed loosely on purpose. */
const alt1host = (): any => (globalThis as any).alt1;

// Colours the stock chatbox palette misses — notably the teal used by
// Leagues / seasonal broadcasts, which is where drop lines live in that mode.
const EXTRA_COLORS: [number, number, number][] = [
  [77, 208, 196], // teal
  [64, 224, 208], // turquoise
  [72, 209, 204], // medium turquoise
  [0, 206, 209], // dark turquoise
  [102, 255, 204], // aqua-green
  [127, 255, 212], // aquamarine
  [153, 255, 221],
  [45, 213, 176],
  [0, 255, 153],
  [102, 255, 153],
  [150, 255, 200],
];

const reader = new ChatBoxReader();
reader.readargs.colors = [
  ...defaultcolors.map((c) => a1lib.mixColor(c[0], c[1], c[2])),
  ...EXTRA_COLORS.map((c) => a1lib.mixColor(c[0], c[1], c[2])),
];
reader.diffReadUseTimestamps = false; // players may not have chat timestamps on

// Leagues / seasonal broadcast lines carry an account badge (ironman, GIM,
// Leagues trophy) right after the timestamp and again before the name. When the
// game scene bleeds through a transparent chat, Alt1's pixel-exact badge match
// fails, the reader stalls straight after "[hh:mm:ss]", and only the timestamp
// comes through. This nudge blindly steps the cursor past whatever is stuck and
// retries the text read.
interface NudgeCtx {
  imgdata: ImageData;
  font: { spacewidth: number };
  colors: [number, number, number][];
  rightx: number;
  baseliney: number;
  text: string;
  addfrag: (f: {
    color: number[];
    index: number;
    text: string;
    xstart: number;
    xend: number;
  }) => void;
}

reader.forwardnudges.push({
  name: "skip-stuck-icon",
  match: /[\]:](\s?)$/,
  fn: (ctx: NudgeCtx): boolean | undefined => {
    const step = Math.max(4, Math.round(ctx.font.spacewidth || 6));
    for (let dx = step; dx <= step * 6; dx += 3) {
      const x = ctx.rightx + dx;
      const data = OCR.readLine(ctx.imgdata, ctx.font as never, ctx.colors, x, ctx.baseliney, true, false);
      if (data && data.text && data.text.trim().length >= 2) {
        ctx.addfrag({ color: [255, 255, 255], index: -1, text: " ", xstart: ctx.rightx, xend: x });
        for (const f of data.fragments) ctx.addfrag(f);
        return true;
      }
    }
    return undefined;
  },
} as never);

// --- Settings + UI ---------------------------------------------------------

let settings: Settings = loadSettings();
const dedup = new Dedup(settings.dedupWindowMs);

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const rsnEl = el<HTMLInputElement>("rsn");
const webhookEl = el<HTMLInputElement>("webhook");
const shotEl = el<HTMLInputElement>("shot");
const debugEl = el<HTMLInputElement>("debug");
const statusEl = el<HTMLDivElement>("status");
const logEl = el<HTMLDivElement>("log");

rsnEl.value = settings.rsn;
webhookEl.value = settings.webhook;
shotEl.checked = settings.screenshot;
debugEl.checked = settings.debugLog;

type Level = "" | "ok" | "warn" | "err";

function log(msg: string, level: Level = ""): void {
  const row = document.createElement("div");
  if (level) row.className = level;
  row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(row);
  while (logEl.childElementCount > 250) logEl.lastElementChild?.remove();
}

function setStatus(msg: string, level: Level = ""): void {
  statusEl.textContent = msg;
  statusEl.className = level;
}

el<HTMLButtonElement>("save").addEventListener("click", () => {
  settings = {
    ...settings,
    rsn: rsnEl.value.trim(),
    webhook: webhookEl.value.trim(),
    screenshot: shotEl.checked,
    debugLog: debugEl.checked,
  };
  saveSettings(settings);
  dedup.setWindow(settings.dedupWindowMs);
  if (settings.debugLog) wantColorSample = true;
  log("Settings saved.", "ok");
});

el<HTMLButtonElement>("test").addEventListener("click", async () => {
  if (!settings.webhook) {
    log("Set a webhook URL first.", "err");
    return;
  }
  try {
    const shot = settings.screenshot ? await captureScreenshot() : null;
    const res = await postDrop(settings.webhook, {
      rsn: settings.rsn || "Test User",
      item: "Zaryte vambraces",
      qty: 1,
      type: "drop",
      value: await getPrice("Zaryte vambraces"),
      screenshot: shot,
    });
    log(res.ok ? "Test message sent." : `Test failed: HTTP ${res.status}`, res.ok ? "ok" : "err");
  } catch (e) {
    log("Test error: " + (e as Error).message, "err");
  }
});

// --- Drop handling -------------------------------------------------------

async function handleLine(text: string): Promise<boolean> {
  const ev = parseLine(text, settings.rsn);
  if (!ev) {
    // Surface near-misses: a line that mentions "received" but didn't parse
    // (wrong RSN spelling, OCR noise, an unexpected phrasing).
    if (/received/i.test(text)) log(`no match: ${text}`, "warn");
    return false;
  }

  if (!settings.webhook) {
    log(`Detected ${ev.qty}x ${ev.item} — but no webhook is set.`, "warn");
    return true;
  }
  if (dedup.check(dedupKeys(ev, settings.rsn))) return true;

  log(`Drop: ${ev.qty}x ${ev.item}${ev.type === "pet" ? " (pet)" : ""}`, "ok");

  const value = await getPrice(ev.item);
  const shot = settings.screenshot ? await captureScreenshot() : null;

  try {
    const res = await postDrop(settings.webhook, {
      rsn: settings.rsn,
      item: ev.item,
      qty: ev.qty,
      type: ev.type,
      value,
      screenshot: shot,
    });
    log(res.ok ? "Posted to Discord." : `Discord error: HTTP ${res.status}`, res.ok ? "ok" : "err");
  } catch (e) {
    log("Post failed: " + (e as Error).message, "err");
  }
  return true;
}

// --- Poll loop ---------------------------------------------------------

const seenThisRun = new Set<string>();
let readFailures = 0; // consecutive null reads
let emptyReads = 0; // consecutive reads that returned no lines at all
let linesSeen = 0;
let dropsMatched = 0;
let wantColorSample = false;

/** Debug aid: log the dominant saturated colours inside the chat rect, so a
 *  missing broadcast colour (e.g. Leagues teal) can be identified exactly. */
function sampleChatColors(img: a1lib.ImgRef): void {
  const box = (reader.pos as unknown as { mainbox?: { rect?: a1lib.RectLike } })
    ?.mainbox?.rect;
  if (!box) return;
  let data: ImageData;
  try {
    data = img.toData(box.x, box.y, box.width, box.height);
  } catch {
    return;
  }
  const counts = new Map<string, number>();
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 120 || max - min < 40) continue; // skip background / greys
    const key = `${(r >> 3) << 3},${(g >> 3) << 3},${(b >> 3) << 3}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `${k}×${n}`)
    .join("   ");
  log("chat colours: " + top);
}

function watchStatus(): void {
  if (emptyReads > 40) {
    // Found the box but nothing is coming through — almost always a chat
    // text size the OCR fonts don't cover.
    setStatus(
      "Chatbox located, but no lines are being read — set RuneScape chat Text size back to the default.",
      "warn",
    );
  } else {
    setStatus(`Watching — ${linesSeen} lines seen, ${dropsMatched} drops.`, "ok");
  }
}

function tick(): void {
  const host = alt1host();
  if (!host) {
    setStatus("Open this page inside Alt1 to use it.", "warn");
    return;
  }
  if (!host.permissionPixel) {
    setStatus("Alt1 is missing the 'pixel' permission for this app.", "err");
    return;
  }

  let img: a1lib.ImgRef;
  try {
    img = a1lib.captureHoldFullRs();
  } catch {
    setStatus("Can't capture the RuneScape client — is the game running?", "warn");
    return;
  }

  if (!reader.pos) {
    reader.pos = (reader.find(img) as unknown as typeof reader.pos) ?? null;
    if (!reader.pos) {
      setStatus("Looking for your chatbox…", "warn");
      return;
    }
    emptyReads = 0;
    log("Chatbox found.", "ok");
    if (settings.debugLog) wantColorSample = true;
  }

  if (wantColorSample) {
    wantColorSample = false;
    sampleChatColors(img);
  }

  const lines = reader.read(img);
  if (lines === null) {
    // Re-locate quickly; a resized / moved chat invalidates the old position.
    if (++readFailures >= 4) {
      reader.pos = null;
      readFailures = 0;
    }
    watchStatus();
    return;
  }
  readFailures = 0;
  emptyReads = lines.length === 0 ? emptyReads + 1 : 0;

  for (const line of lines) {
    const text = line.text?.trim();
    if (!text || seenThisRun.has(text)) continue;
    seenThisRun.add(text);
    if (seenThisRun.size > 500) seenThisRun.clear();
    linesSeen++;
    if (settings.debugLog) log(`« ${text}`);
    void handleLine(text).then((matched) => {
      if (matched) dropsMatched++;
    });
  }
  watchStatus();
}

setInterval(tick, 600);
log("Discord Koek started.");
