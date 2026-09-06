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
import { getItem } from "./prices";
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

/** A full chat line that came back as OCR noise — stray symbols never seen in
 *  RS chat, long character runs, or mostly non-letters. */
function lineLooksGarbled(t: string): boolean {
  if (/["|\\*=<>`~]/.test(t)) return true;
  if (/(.)\1{4,}/.test(t)) return true;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const nonspace = t.replace(/\s/g, "").length;
  return nonspace > 6 && letters / nonspace < 0.5;
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
const whInputRow = el<HTMLDivElement>("wh-input-row");
const whSavedRow = el<HTMLDivElement>("wh-saved-row");
const whTailEl = el<HTMLElement>("wh-tail");
const shotEl = el<HTMLInputElement>("shot");
const lvlMinEl = el<HTMLInputElement>("lvlmin");
const statusEl = el<HTMLDivElement>("status");
const statusTextEl = el<HTMLSpanElement>("status-text");
const lastEl = el<HTMLDivElement>("last");

const DEBUG =
  new URLSearchParams(location.search).has("debug") || !!settings.debugLog;

const CATEGORIES: CategoryToggle[] = [
  "drops", "levelups", "milestones", "titles", "areatasks", "clues",
];
const catEls = Object.fromEntries(
  CATEGORIES.map((c) => [c, el<HTMLInputElement>(`c-${c}`)]),
) as Record<CategoryToggle, HTMLInputElement>;

rsnEl.value = settings.rsn;
shotEl.checked = settings.screenshot;
lvlMinEl.value = String(settings.levelUpMin);
for (const c of CATEGORIES) catEls[c].checked = settings.categories[c];

type Level = "" | "ok" | "warn" | "err";

/** Debug-only console line (visible with ?debug or a stored debugLog flag). */
function dlog(msg: string): void {
  if (DEBUG) console.log("[koek] " + msg);
}

function setStatus(msg: string, level: Level = ""): void {
  statusTextEl.textContent = msg;
  statusEl.className = "status" + (level ? " " + level : "");
}

function setLast(ev: GameEvent): void {
  lastEl.innerHTML =
    "Last broadcast: <b></b> · " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  lastEl.querySelector("b")!.textContent = describe(ev);
  lastEl.classList.remove("hidden");
}

// --- webhook show / hide ------------------------------------------------

let editingWebhook = false;

function renderWebhook(): void {
  const saved = settings.webhook;
  if (saved && !editingWebhook) {
    whTailEl.textContent = saved.slice(-6);
    whSavedRow.classList.remove("hidden");
    whInputRow.classList.add("hidden");
  } else {
    webhookEl.value = editingWebhook ? saved : webhookEl.value;
    whInputRow.classList.remove("hidden");
    whSavedRow.classList.add("hidden");
  }
}

el<HTMLButtonElement>("wh-change").addEventListener("click", () => {
  editingWebhook = true;
  renderWebhook();
  webhookEl.focus();
});

renderWebhook();

el<HTMLButtonElement>("save").addEventListener("click", () => {
  const lvlMin = Math.min(120, Math.max(2, parseInt(lvlMinEl.value, 10) || 99));
  const webhook = whInputRow.classList.contains("hidden")
    ? settings.webhook
    : webhookEl.value.trim();
  settings = {
    ...settings,
    rsn: rsnEl.value.trim(),
    webhook,
    screenshot: shotEl.checked,
    levelUpMin: lvlMin,
    categories: Object.fromEntries(
      CATEGORIES.map((c) => [c, catEls[c].checked]),
    ) as Settings["categories"],
  };
  lvlMinEl.value = String(lvlMin);
  saveSettings(settings);
  dedup.setWindow(settings.dedupWindowMs);
  editingWebhook = false;
  webhookEl.value = "";
  renderWebhook();
  setStatus("Settings saved.", "ok");
});

el<HTMLButtonElement>("preview").addEventListener("click", async () => {
  if (!settings.webhook) {
    setStatus("Add a webhook first, then Save.", "warn");
    return;
  }
  const sample: GameEvent = {
    kind: "drop",
    item: "Zaryte vambraces",
    qty: 1,
    pet: false,
    raw: "preview",
  };
  try {
    const info = await getItem(sample.item);
    const res = await postEvent(settings.webhook, sample, {
      rsn: settings.rsn || "Preview",
      value: info.price,
      itemId: info.id,
    });
    setStatus(res.ok ? "Test drop sent." : `Test failed (HTTP ${res.status}).`, res.ok ? "ok" : "err");
  } catch {
    setStatus("Test failed — couldn't reach Discord.", "err");
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

async function handleLine(text: string): Promise<void> {
  const ev = parseLine(text, settings.rsn);
  if (!ev) {
    if (DEBUG && looksInteresting(text)) dlog(`no match: ${text}`);
    return;
  }

  if (!settings.categories[categoryOf(ev.kind)]) return;
  if (ev.kind === "levelup" && !ev.virtual && ev.level < settings.levelUpMin) return;
  if (!settings.webhook) {
    dlog(`matched ${describe(ev)} but no webhook set`);
    return;
  }
  if (dedup.check(dedupKeys(ev, settings.rsn))) return;

  dlog(`${ev.kind}: ${describe(ev)}`);

  const wantsItem = ev.kind === "drop" || ev.kind === "clue";
  const info = wantsItem ? await getItem((ev as { item: string }).item) : null;
  const shot = wantsItem && settings.screenshot ? await captureScreenshot() : null;

  try {
    const res = await postEvent(settings.webhook, ev, {
      rsn: settings.rsn,
      value: info?.price ?? null,
      itemId: info?.id ?? null,
      screenshot: shot,
    });
    if (res.ok) {
      setLast(ev);
    } else {
      setStatus(`Discord rejected the post (HTTP ${res.status}).`, "err");
      dlog(`discord HTTP ${res.status}`);
    }
  } catch (e) {
    setStatus("Couldn't reach Discord.", "err");
    dlog("post failed: " + (e as Error).message);
  }
}

// --- Poll loop ---------------------------------------------------------

const seenThisRun = new Set<string>();
let readFailures = 0; // consecutive null reads
let emptyReads = 0; // consecutive reads that returned no lines at all
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
  dlog(`auto-detected RSN: ${name}`);
}

function watchStatus(): void {
  if (emptyReads > 40) {
    setStatus(
      "Chat box found, but lines aren't readable — use the default chat text size.",
      "warn",
    );
  } else if (!settings.webhook) {
    setStatus("Add your Discord webhook to start broadcasting.", "warn");
  } else if (!settings.rsn) {
    setStatus("Watching — detecting your name…", "ok");
  } else {
    setStatus("Watching your chat box.", "ok");
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
    dlog("chat box located");
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
        // Only take the rescue if it read *more* and isn't OCR vomit — a
        // garbled rescue varies between polls and slips past de-dup.
        if (
          rescued &&
          !lineLooksGarbled(rescued) &&
          rescued.split(/\s+/).length > text.split(/\s+/).length
        ) {
          dlog(`rescued: ${rescued}`);
          text = rescued;
        }
      }
    }
    if (!text || seenThisRun.has(text)) continue;
    seenThisRun.add(text);
    if (seenThisRun.size > 500) seenThisRun.clear();
    dlog(`« ${text}`);
    void handleLine(text);
  }
  watchStatus();
}

setInterval(tick, 600);
dlog("started");
