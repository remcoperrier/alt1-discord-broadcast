import * as a1lib from "alt1/base";
import * as ChatboxModule from "alt1/chatbox";

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

// --- Settings + UI ---------------------------------------------------------

let settings: Settings = loadSettings();
const dedup = new Dedup(settings.dedupWindowMs);

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const rsnEl = el<HTMLInputElement>("rsn");
const webhookEl = el<HTMLInputElement>("webhook");
const shotEl = el<HTMLInputElement>("shot");
const statusEl = el<HTMLDivElement>("status");
const logEl = el<HTMLDivElement>("log");

rsnEl.value = settings.rsn;
webhookEl.value = settings.webhook;
shotEl.checked = settings.screenshot;

type Level = "" | "ok" | "warn" | "err";

function log(msg: string, level: Level = ""): void {
  const row = document.createElement("div");
  if (level) row.className = level;
  row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(row);
  while (logEl.childElementCount > 100) logEl.lastElementChild?.remove();
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

async function handleLine(text: string): Promise<void> {
  const ev = parseLine(text, settings.rsn);
  if (!ev) return;

  if (!settings.webhook) {
    log(`Detected ${ev.qty}x ${ev.item} — but no webhook is set.`, "warn");
    return;
  }
  if (dedup.check(dedupKeys(ev, settings.rsn))) return;

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
}

// --- Poll loop ---------------------------------------------------------

const seenThisRun = new Set<string>();
let readFailures = 0;

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
    setStatus(
      reader.pos ? "Chatbox found — watching for drops." : "Looking for your chatbox…",
      reader.pos ? "ok" : "warn",
    );
    return;
  }

  const lines = reader.read(img);
  if (lines === null) {
    if (++readFailures > 10) {
      reader.pos = null;
      readFailures = 0;
    }
    return;
  }
  readFailures = 0;

  for (const line of lines) {
    const text = line.text?.trim();
    if (!text || seenThisRun.has(text)) continue;
    seenThisRun.add(text);
    if (seenThisRun.size > 500) seenThisRun.clear();
    void handleLine(text);
  }
}

setInterval(tick, 600);
log("Discord Koek started.");
