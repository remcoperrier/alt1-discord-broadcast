/**
 * Time-windowed de-duplication. A key is "seen" for `windowMs` after it is
 * recorded. State is mirrored to localStorage so a plugin restart doesn't
 * re-post lines that are still on screen.
 */
export class Dedup {
  private seen = new Map<string, number>();

  constructor(
    private windowMs: number,
    private storeKey = "discord-koek:dedup",
  ) {
    try {
      const raw = localStorage.getItem(this.storeKey);
      if (raw) this.seen = new Map(JSON.parse(raw) as [string, number][]);
    } catch {
      /* ignore corrupt state */
    }
    this.prune();
  }

  setWindow(ms: number): void {
    this.windowMs = ms;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [k, t] of this.seen) if (t < cutoff) this.seen.delete(k);
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify([...this.seen]));
    } catch {
      /* storage unavailable */
    }
  }

  /**
   * @returns true if any key was seen within the window (caller should skip).
   * Otherwise records every key with the current timestamp and returns false.
   */
  check(keys: string[]): boolean {
    this.prune();
    if (keys.some((k) => this.seen.has(k))) return true;
    const now = Date.now();
    for (const k of keys) this.seen.set(k, now);
    this.persist();
    return false;
  }
}
