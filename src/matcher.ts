import { canonItem } from "./format";

/** Discriminated union of everything the plugin can broadcast. `raw` is the
 *  normalised source line, used for de-duplication. */
export type GameEvent = { raw: string } & (
  | { kind: "drop"; item: string; qty: number; pet: boolean }
  | { kind: "levelup"; skill: string; level: number; virtual: boolean }
  | { kind: "xp"; skill: string; xp: number }
  | { kind: "skill99"; skill: string }
  | { kind: "skill120"; skill: string }
  | { kind: "feat"; text: string } // "... in all skills", "200 million XP ...", etc.
  | { kind: "title"; title: string; flavour: string | null }
  | { kind: "quest"; quest: string }
  | { kind: "areatask"; area: string; tier: string | null }
  | { kind: "clue"; item: string }
);

export type EventKind = GameEvent["kind"];

const SKILLS = new Set(
  [
    "attack", "strength", "defence", "ranged", "prayer", "magic", "runecrafting",
    "construction", "dungeoneering", "constitution", "agility", "herblore",
    "thieving", "crafting", "fletching", "slayer", "hunter", "divination",
    "mining", "smithing", "fishing", "cooking", "firemaking", "woodcutting",
    "farming", "summoning", "archaeology", "necromancy",
  ],
);

/**
 * Strip colour tags, a leading timestamp, and broadcast prefixes
 * ("*News:", "Leagues:", "[Clan] Leagues:", arrow glyphs); fold non-breaking
 * spaces; collapse whitespace.
 */
export function normalize(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/<\/?col[^>]*>/gi, "")
    .replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "")
    .replace(/^[\s*.•‣⁃▪←-⇿➔-➿⤷↝∞»›·]+/, "")
    .replace(/^\s*(?:\[[^\]]+\]\s*)?(?:News|Your Leagues|Leagues|Group|Clan)\s*:\s*/i, "")
    .replace(/^[\s*.•‣⁃▪←-⇿➔-➿⤷↝∞»›·]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HAS_RECEIVED = /\bhas\s+received\b/i;

function stripArticle(s: string): string {
  return s.replace(/^(?:a|an|some|the)\s+/i, "").trim();
}

function hasRsn(line: string, rsn: string): boolean {
  return !!rsn.trim() && line.toLowerCase().includes(rsn.trim().toLowerCase());
}

// --- individual matchers -------------------------------------------------

function matchDrop(line: string, rsn: string): GameEvent | null {
  if (!HAS_RECEIVED.test(line) || !hasRsn(line, rsn)) return null;

  let rest = line.split(HAS_RECEIVED)[1];
  if (!rest) return null;
  rest = rest.trim().replace(/[.!\s]+$/, "").trim();
  if (!rest) return null;

  const pet =
    rest.match(/^(.+?),\s*the\s+[\w'-]+\s+pet\b/i) ||
    rest.match(/^(?:a|the)\s+(.+?)\s+pet\b/i);
  if (pet) return { kind: "drop", item: pet[1].trim(), qty: 1, pet: true, raw: line };

  const colon = rest.match(/(?:drop|item|reward)s?\s*:\s*(.+)$/i);
  if (colon) {
    const item = stripArticle(colon[1].trim().replace(/[.!]+$/, ""));
    return item ? { kind: "drop", item, qty: 1, pet: false, raw: line } : null;
  }

  rest = rest.replace(/\s+drop$/i, "").trim();
  let qty = 1;
  const q = rest.match(/^(\d[\d,]*)\s*(?:x\s+)?(.+)$/i);
  if (q) {
    qty = parseInt(q[1].replace(/,/g, ""), 10) || 1;
    rest = q[2].trim();
  }
  const item = stripArticle(rest);
  return item ? { kind: "drop", item, qty, pet: false, raw: line } : null;
}

function matchLevelUp(line: string): GameEvent | null {
  // "You've just advanced a[ virtual] Defence level! You have reached level 104."
  const m = line.match(
    /you'?ve just advanced (?:a |your )?(virtual )?([A-Za-z]+) level.*?level (\d+)/i,
  );
  if (!m) return null;
  const skill = m[2].toLowerCase();
  if (!SKILLS.has(skill)) return null;
  return {
    kind: "levelup",
    skill,
    level: parseInt(m[3], 10),
    virtual: !!m[1],
    raw: line,
  };
}

function matchXp(line: string): GameEvent | null {
  // "Well done! You've achieved 20,000,000 XP in Defence!"
  const m = line.match(/you'?ve achieved ([\d,]+) (?:xp|experience) in ([A-Za-z]+)/i);
  if (!m) return null;
  const skill = m[2].toLowerCase();
  if (!SKILLS.has(skill)) return null;
  return { kind: "xp", skill, xp: parseInt(m[1].replace(/,/g, ""), 10), raw: line };
}

function matchSkillMilestone(line: string, rsn: string): GameEvent | null {
  if (!hasRsn(line, rsn)) return null;
  const m = line.match(/has (?:just )?achieved (?:level )?(99|120) ([A-Za-z]+)\b/i);
  if (!m) return null;
  const skill = m[2].toLowerCase();
  if (!SKILLS.has(skill)) return null;
  return { kind: m[1] === "120" ? "skill120" : "skill99", skill, raw: line };
}

function matchFeat(line: string, rsn: string): GameEvent | null {
  if (!hasRsn(line, rsn)) return null;
  // broad achievement broadcasts: "... in all skills!", "200 million XP ...",
  // "... the trimmed Completionist Cape!", first boss kills, etc.
  const m = line.match(/has (?:just )?(?:achieved|been awarded|earned|completed) (.+?)!?$/i);
  if (!m) return null;
  const text = m[1].trim();
  if (/^\d+ [A-Za-z]+$/.test(text)) return null; // handled by matchSkillMilestone
  if (/\bdrop$/i.test(text)) return null; // that's a drop line
  return { kind: "feat", text, raw: line };
}

function matchTitle(line: string, rsn: string): GameEvent | null {
  if (!hasRsn(line, rsn)) return null;
  const m = line.match(/has unlocked the (golden |trimmed )?'([^']+)' title/i);
  if (!m) return null;
  return { kind: "title", title: m[2].trim(), flavour: m[1] ? m[1].trim() : null, raw: line };
}

function matchQuest(line: string): GameEvent | null {
  // personal: "Congratulations! You have completed <Quest>."
  const m = line.match(
    /you have completed (?:the quest[:.]?\s*)?(?:['"]?)(.+?)(?:['"]?)[.!]?$/i,
  );
  if (!m) return null;
  const quest = m[1].trim();
  if (/achievement|task|treasure trail|challenge|reclaiming/i.test(quest)) return null;
  if (quest.split(/\s+/).length > 8) return null; // sentence, not a quest name
  return { kind: "quest", quest, raw: line };
}

function matchAreaTask(line: string): GameEvent | null {
  // personal / friends: "... completed all[ of the] [Easy] Desert achievements/tasks ..."
  const m = line.match(
    /completed all(?: of)?(?: the)? (easy|medium|hard|elite|master)?\s*([A-Za-z' ]+?) (?:area )?(?:achievements|tasks)\b/i,
  );
  if (!m) return null;
  return {
    kind: "areatask",
    area: m[2].trim(),
    tier: m[1] ? m[1].trim().toLowerCase() : null,
    raw: line,
  };
}

function matchClue(line: string, rsn: string): GameEvent | null {
  if (!hasRsn(line, rsn)) return null;
  const m = line.match(/completed a treasure trail and received (.+?)[.!]?$/i);
  if (!m) return null;
  return { kind: "clue", item: stripArticle(m[1].trim()), raw: line };
}

// --- entry point -------------------------------------------------------

/** Parse one chat line into a GameEvent, or null. Matchers are tried in order
 *  of specificity. */
export function parseLine(rawText: string, rsn: string): GameEvent | null {
  const line = normalize(rawText);
  if (!line) return null;

  return (
    matchDrop(line, rsn) ||
    matchLevelUp(line) ||
    matchXp(line) ||
    matchSkillMilestone(line, rsn) ||
    matchTitle(line, rsn) ||
    matchClue(line, rsn) ||
    matchAreaTask(line) ||
    matchQuest(line) ||
    matchFeat(line, rsn) ||
    null
  );
}

/** A line that looks like it *should* have matched — for the "no match" debug log. */
export function looksInteresting(rawText: string): boolean {
  return /\b(has received|advanced a|advanced your|you've achieved|has achieved|has unlocked|completed a treasure trail|completed all)\b/i.test(
    normalize(rawText),
  );
}

/** De-dup keys: the exact line, plus a semantic key so the same event from two
 *  chat channels (clan + News) collapses to one post. */
export function dedupKeys(ev: GameEvent, rsn: string): string[] {
  const r = rsn.trim().toLowerCase();
  let sem: string;
  switch (ev.kind) {
    case "drop":
      sem = `${ev.pet ? "pet" : "drop"}|${canonItem(ev.item)}`;
      break;
    case "levelup":
      sem = `levelup|${ev.skill}|${ev.virtual ? "v" : ""}${ev.level}`;
      break;
    case "xp":
      sem = `xp|${ev.skill}|${ev.xp}`;
      break;
    case "skill99":
    case "skill120":
      sem = `${ev.kind}|${ev.skill}`;
      break;
    case "feat":
      sem = `feat|${ev.text.toLowerCase()}`;
      break;
    case "title":
      sem = `title|${ev.title.toLowerCase()}`;
      break;
    case "quest":
      sem = `quest|${ev.quest.toLowerCase()}`;
      break;
    case "areatask":
      sem = `areatask|${ev.area.toLowerCase()}|${ev.tier ?? ""}`;
      break;
    case "clue":
      sem = `clue|${canonItem(ev.item)}`;
      break;
  }
  return ["line:" + ev.raw.toLowerCase(), "evt:" + r + "|" + sem];
}
