/** Compact gp: 73_900_000 -> "73.9M", 12_300 -> "12.3K", 640 -> "640". */
export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return trimOne(n / 1e9) + "B";
  if (abs >= 1e6) return trimOne(n / 1e6) + "M";
  if (abs >= 1e3) return trimOne(n / 1e3) + "K";
  return String(Math.round(n));
}

function trimOne(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

/**
 * Canonical item key for de-duplication: lowercase, no articles / "some",
 * no trailing "drop", punctuation flattened, whitespace collapsed.
 */
export function canonItem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bdrop\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|some|the)\s+/, "")
    .trim();
}

/** Display / wiki / GE name: sentence case (RS item pages are sentence case). */
export function displayItem(name: string): string {
  const t = name.trim().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Link to the item's RuneScape Wiki page. No API needed; the wiki resolves case + redirects. */
export function wikiUrl(name: string): string {
  const page = displayItem(name).replace(/ /g, "_");
  return "https://runescape.wiki/w/" + encodeURIComponent(page);
}
