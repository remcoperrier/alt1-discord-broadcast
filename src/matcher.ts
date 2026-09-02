import { canonItem } from "./format";

export interface DropEvent {
  /** Item text as parsed from the chat line (not yet sentence-cased). */
  item: string;
  qty: number;
  type: "drop" | "pet";
  /** Normalised line text, used as one of the de-dup keys. */
  rawLine: string;
}

/**
 * Strip colour tags, a leading timestamp, and broadcast prefixes ("*News:", arrows);
 * fold non-breaking spaces; collapse whitespace.
 */
export function normalize(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/<\/?col[^>]*>/gi, "")
    .replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "")
    // leading broadcast decoration: whitespace, asterisks, bullets, arrow glyphs
    .replace(/^[\s*.•‣⁃▪←-⇿➔-➿]+/, "")
    .replace(/^\s*News:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HAS_RECEIVED = /\bhas\s+received\b/i;

function stripArticle(s: string): string {
  return s.replace(/^(?:a|an|some|the)\s+/i, "").trim();
}

/**
 * Returns a DropEvent when the line contains the player's RSN *and* the phrase
 * "has received"; otherwise null. Deliberately permissive per the spec:
 * "anything with your own RSN in it that says 'has received'".
 */
export function parseLine(rawText: string, rsn: string): DropEvent | null {
  if (!rsn.trim()) return null;
  const line = normalize(rawText);
  if (!HAS_RECEIVED.test(line)) return null;
  if (!line.toLowerCase().includes(rsn.trim().toLowerCase())) return null;

  let rest = line.split(HAS_RECEIVED)[1];
  if (!rest) return null;
  rest = rest.trim().replace(/[.!\s]+$/, "").trim();
  if (!rest) return null;

  // Pet: "Bubbles, the Fishing pet drop at 6,166,677 XP"  |  "a <name> pet"
  const pet =
    rest.match(/^(.+?),\s*the\s+[\w'-]+\s+pet\b/i) ||
    rest.match(/^(?:a|the)\s+(.+?)\s+pet\b/i);
  if (pet) {
    return { item: pet[1].trim(), qty: 1, type: "pet", rawLine: line };
  }

  // Clan-style "... a rare drop: Zaryte vambraces"
  const colon = rest.match(/(?:drop|item|reward)s?\s*:\s*(.+)$/i);
  if (colon) {
    const item = stripArticle(colon[1].trim().replace(/[.!]+$/, ""));
    return item ? { item, qty: 1, type: "drop", rawLine: line } : null;
  }

  // Standard "... a Memory Dowser drop" | "... some gloves of subjugation drop"
  rest = rest.replace(/\s+drop$/i, "").trim();
  let qty = 1;
  const q = rest.match(/^(\d[\d,]*)\s*(?:x\s+)?(.+)$/i);
  if (q) {
    qty = parseInt(q[1].replace(/,/g, ""), 10) || 1;
    rest = q[2].trim();
  }
  const item = stripArticle(rest);
  return item ? { item, qty, type: "drop", rawLine: line } : null;
}

/**
 * Two de-dup keys per event:
 *  - the exact normalised line (kills re-reads of the same on-screen text)
 *  - rsn|item|type (collapses the clan line + *News: line for one drop, no timestamp needed)
 */
export function dedupKeys(ev: DropEvent, rsn: string): string[] {
  return [
    "line:" + ev.rawLine.toLowerCase(),
    "evt:" + rsn.trim().toLowerCase() + "|" + canonItem(ev.item) + "|" + ev.type,
  ];
}
