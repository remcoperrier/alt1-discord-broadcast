export interface Settings {
  /** Exact in-game display name of the account running this plugin. */
  rsn: string;
  /** Discord webhook URL to POST drops to. */
  webhook: string;
  /** Attach a screenshot of the RS client to each drop. */
  screenshot: boolean;
  /** How long a drop is remembered for de-duplication, in ms. */
  dedupWindowMs: number;
}

const KEY = "discord-koek:settings";

const DEFAULTS: Settings = {
  rsn: "",
  webhook: "",
  screenshot: false,
  dedupWindowMs: 90_000,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* corrupt / unavailable storage -> fall through to defaults */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable -> settings simply won't persist */
  }
}
