import type { EventKind } from "./matcher";

export type CategoryToggle =
  | "drops"
  | "levelups"
  | "milestones"
  | "titles"
  | "areatasks"
  | "clues";

export interface Settings {
  /** Exact in-game display name of the account running this plugin. */
  rsn: string;
  /** Discord webhook URL to POST events to. */
  webhook: string;
  /** Discord user id (snowflake) to @mention on every broadcast; "" = no ping. */
  pingUserId: string;
  /** Attach a screenshot of the RS client to drop / clue posts. */
  screenshot: boolean;
  /** Log every OCR'd chat line to the panel (diagnostics). */
  debugLog: boolean;
  /** Which categories to broadcast. */
  categories: Record<CategoryToggle, boolean>;
  /** Only broadcast normal level-ups at or above this level (virtual level-ups always post). */
  levelUpMin: number;
  /** How long an event is remembered for de-duplication, in ms. */
  dedupWindowMs: number;
}

const KEY = "discord-koek:settings";

const DEFAULTS: Settings = {
  rsn: "",
  webhook: "",
  pingUserId: "",
  screenshot: false,
  debugLog: false,
  categories: {
    drops: true,
    levelups: true,
    milestones: true,
    titles: true,
    areatasks: true,
    clues: true,
  },
  levelUpMin: 99,
  dedupWindowMs: 150_000,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULTS,
        ...parsed,
        categories: { ...DEFAULTS.categories, ...(parsed.categories ?? {}) },
        // enforce a floor so older stored values still get the wider window
        dedupWindowMs: Math.max(150_000, parsed.dedupWindowMs ?? 0),
      };
    }
  } catch {
    /* corrupt / unavailable storage -> fall through to defaults */
  }
  return { ...DEFAULTS, categories: { ...DEFAULTS.categories } };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable -> settings simply won't persist */
  }
}

/** Map an event kind to the category toggle that gates it. */
export function categoryOf(kind: EventKind): CategoryToggle {
  switch (kind) {
    case "drop":
      return "drops";
    case "levelup":
      return "levelups";
    case "xp":
    case "skill99":
    case "skill120":
    case "feat":
      return "milestones";
    case "title":
      return "titles";
    case "areatask":
      return "areatasks";
    case "clue":
      return "clues";
  }
}
