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

import {
  loadSettings,
  saveSettings,
  categoryOf,
  type Settings,
  type CategoryToggle,
} from "./settings";
import { parseLine, dedupKeys, looksInteresting, type GameEvent } from "./matcher";
import { Dedup } from "./dedup";
import { getPrice } from "./prices";
import { postEvent } from "./discord";
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

// --- RSN auto-detection ----------------------------------------------------

/** Read the player's name from the chat input line
 *  ("<name>[, the <title>]: [Public Chat - Press Enter to Chat]"). The name is
 *  always white; titles and icons are other colours, so a white-only OCR pass
 *  isolates it. */
function detectRsnFromChat(img: a1lib.ImgRef): string | null {
  const font = reader.font as unknown as { def: unknown; lineheight?: number } | null;
  const box = (reader.pos as unknown as { mainbox?: { rect?: a1lib.RectLike } })
    ?.mainbox?.rect;
  if (!font || !box) return null;

  const lh = Math.max(10, Math.round(font.lineheight ?? 14));
  let buf: ImageData;
  try {
    buf = img.toData(box.x, box.y, box.width, box.height + lh * 2);
  } catch {
    try {
      buf = img.toData(box.x, box.y, box.width, box.height);
    } catch {
      return null;
    }
  }

  const white = [[255, 255, 255]] as never;
  for (let y = buf.height - 3; y >= box.height - lh * 3 && y > 2; y -= 2) {
    const full = OCR.readLine(buf as never, font.def as never, defaultcolors as never, 0, y, true, false) as { text?: string };
    if (!/enter to chat/i.test(full?.text ?? "")) continue;
    const wht = OCR.readLine(buf as never, font.def as never, white, 0, y, true, false) as { text?: string };
    const name = cleanName(wht?.text ?? "", full?.text ?? "");
    if (name) return name;
  }
  return null;
}

function cleanName(whiteText: string, fullText: string): string | null {
  let n = whiteText.replace(/\s+/g, " ").trim().split("[")[0].replace(/[\s,:]+$/, "").trim();
  n = n.replace(/^[^A-Za-z0-9]+/, "").trim();
  if (!n) {
    n = fullText.split("[")[0].replace(/[\s,:]+$/, "").replace(/^[^A-Za-z0-9]+/, "").trim();
    if (n.split(/\s+/).length > 2) return null; // can't split name from title in a colour blob
  }
  if (n.length < 1 || n.length > 12) return null;
  if (/\b(chat|press|enter|public|clan|group|private|friends|guest|the)\b/i.test(n)) return null;
  return n;
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
const lvlMinEl = el<HTMLInputElement>("lvlmin");
const statusEl = el<HTMLDivElement>("status");
const logEl = el<HTMLDivElement>("log");

const CATEGORIES: CategoryToggle[] = [
  "drops", "levelups", "milestones", "titles", "areatasks", "clues",
];
const catEls = Object.fromEntries(
  CATEGORIES.map((c) => [c, el<HTMLInputElement>(`c-${c}`)]),
) as Record<CategoryToggle, HTMLInputElement>;

rsnEl.value = settings.rsn;
webhookEl.value = settings.webhook;
shotEl.checked = settings.screenshot;
debugEl.checked = settings.debugLog;
lvlMinEl.value = String(settings.levelUpMin);
for (const c of CATEGORIES) catEls[c].checked = settings.categories[c];

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
  const lvlMin = Math.min(120, Math.max(2, parseInt(lvlMinEl.value, 10) || 99));
  settings = {
    ...settings,
    rsn: rsnEl.value.trim(),
    webhook: webhookEl.value.trim(),
    screenshot: shotEl.checked,
    debugLog: debugEl.checked,
    levelUpMin: lvlMin,
    categories: Object.fromEntries(
      CATEGORIES.map((c) => [c, catEls[c].checked]),
    ) as Settings["categories"],
  };
  lvlMinEl.value = String(lvlMin);
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
    const res = await postEvent(
      settings.webhook,
      { kind: "drop", item: "Zaryte vambraces", qty: 1, pet: false, raw: "test" },
      { rsn: settings.rsn || "Test User", value: await getPrice("Zaryte vambraces"), screenshot: shot },
    );
    log(res.ok ? "Test message sent." : `Test failed: HTTP ${res.status}`, res.ok ? "ok" : "err");
  } catch (e) {
    log("Test error: " + (e as Error).message, "err");
  }
});

// --- Event handling ----------------------------------------------------

function describe(ev: GameEvent): string {
  switch (ev.kind) {
    case "drop": return `${ev.qty}x ${ev.item}${ev.pet ? " (pet)" : ""}`;
    case "levelup": return `${ev.virtual ? "virtual " : ""}level ${ev.level} ${ev.skill}`;
    case "xp": return `${ev.xp.toLocaleString()} XP ${ev.skill}`;
    case "skill99": return `99 ${ev.skill}`;
    case "skill120": return `120 ${ev.skill}`;
    case "feat": return ev.text;
    case "title": return `title '${ev.title}'`;
    case "areatask": return `${ev.tier ?? ""} ${ev.area} achievements`.trim();
    case "clue": return `clue: ${ev.item}`;
  }
}

async function handleLine(text: string): Promise<boolean> {
  const ev = parseLine(text, settings.rsn);
  if (!ev) {
    if (looksInteresting(text)) log(`no match: ${text}`, "warn");
    return false;
  }

  // category gate
  if (!settings.categories[categoryOf(ev.kind)]) return true;
  // level-up threshold (virtual level-ups always pass)
  if (ev.kind === "levelup" && !ev.virtual && ev.level < settings.levelUpMin) return true;

  if (!settings.webhook) {
    log(`Detected ${describe(ev)} — but no webhook is set.`, "warn");
    return true;
  }
  if (dedup.check(dedupKeys(ev, settings.rsn))) return true;

  log(`${ev.kind}: ${describe(ev)}`, "ok");

  const wantsItem = ev.kind === "drop" || ev.kind === "clue";
  const value = wantsItem ? await getPrice((ev as { item: string }).item) : null;
  const shot = wantsItem && settings.screenshot ? await captureScreenshot() : null;

  try {
    const res = await postEvent(settings.webhook, ev, { rsn: settings.rsn, value, screenshot: shot });
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
let rsnDetectCooldown = 0; // poll ticks until the next auto-detect attempt

function maybeDetectRsn(img: a1lib.ImgRef): void {
  if (settings.rsn) return;
  if (rsnDetectCooldown-- > 0) return;
  rsnDetectCooldown = 25; // ~15s between attempts
  let name: string | null = null;
  try {
    name = detectRsnFromChat(img);
  } catch {
    name = null;
  }
  if (!name) return;
  settings = { ...settings, rsn: name };
  saveSettings(settings);
  rsnEl.value = name;
  log(`Auto-detected RuneScape name: ${name}`, "ok");
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

  maybeDetectRsn(img);

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
