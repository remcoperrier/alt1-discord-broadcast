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

const reader = new ChatBoxReader();
reader.readargs.colors = defaultcolors.map((c) => a1lib.mixColor(c[0], c[1], c[2]));
reader.diffReadUseTimestamps = false; // players may not have chat timestamps on
reader.diffRead = false; // return every visible line each poll; we de-dup ourselves

// Group / Leagues / clan broadcast lines carry channel + account glyphs that
// aren't badge icons Alt1 knows, and its forward reader stalls at the first one
// — often leaving just "[hh:mm:ss]". When a returned line looks stalled we
// re-scan that physical row ourselves, stepping the cursor past any gap/glyph
// and stitching the text runs together.
function rescueRow(buf: ImageData, basey: number): string {
  const font = reader.font;
  const box = (reader.pos as unknown as { mainbox?: { rect?: a1lib.RectLike } })
    ?.mainbox?.rect;
  if (!font || !box) return "";
  const localY = Math.round(basey - box.y);
  if (localY < 1 || localY >= box.height - 1) return "";

  let x = 0;
  let out = "";
  let misses = 0;
  while (x < box.width && misses < 60) {
    const run = OCR.readLine(
      buf as never,
      font.def as never,
      defaultcolors as never,
      x,
      localY,
      true,
      false,
    ) as { text?: string; fragments?: { xend?: number }[] };
    const t = (run?.text ?? "").trim();
    if (t.length >= 1) {
      out += (out === "" ? "" : " ") + t;
      const frags = run.fragments ?? [];
      const last = frags[frags.length - 1];
      x = (last && typeof last.xend === "number" ? last.xend : x) + 2;
      misses = 0;
    } else {
      x += 2;
      misses++;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** A returned chat line that is really just a timestamp / channel tag, or ends
 *  on a glyph the reader stalled at. */
function looksStalled(t: string): boolean {
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  return words < 4 || /[\]:)»›·⤷↝∞]\s*$/.test(t);
}

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

  const box = (reader.pos as unknown as { mainbox?: { rect?: a1lib.RectLike } })
    ?.mainbox?.rect;
  let boxBuf: ImageData | null | undefined;
  const getBoxBuf = (): ImageData | null => {
    if (boxBuf === undefined) {
      try {
        boxBuf = box ? img.toData(box.x, box.y, box.width, box.height) : null;
      } catch {
        boxBuf = null;
      }
    }
    return boxBuf;
  };

  for (const line of lines) {
    let text = line.text?.trim() ?? "";
    if (looksStalled(text)) {
      const buf = getBoxBuf();
      if (buf) {
        const rescued = rescueRow(buf, line.basey);
        if (rescued.split(/\s+/).length > text.split(/\s+/).length) {
          if (settings.debugLog && rescued) log(`rescued: ${rescued}`);
          text = rescued;
        }
      }
    }
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
