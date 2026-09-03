// Quick sanity check for the chat-line matcher. Run: npm run check
import { parseLine, dedupKeys, normalize } from "../src/matcher.ts";

/** [line, rsn, expect]  expect: null | partial GameEvent to match on */
const cases = [
  // drops
  ["[20:11:29] *News: GlaZsz has received a Memory Dowser drop!", "GlaZsz",
    { kind: "drop", item: "Memory Dowser", qty: 1, pet: false }],
  ["[20:15:32] *News: BRB CATS DED has received Bubbles, the Fishing pet drop at 6,166,677 XP!", "BRB CATS DED",
    { kind: "drop", item: "Bubbles", pet: true }],
  ["catsleep has received some gloves of subjugation drop!", "catsleep",
    { kind: "drop", item: "gloves of subjugation" }],
  ["[19:02:11] Wintery High has received a rare drop: Zamorak hilt", "Wintery High",
    { kind: "drop", item: "Zamorak hilt" }],
  ["[22:56:45] Leagues: ⤷taleyy has received an Orb of corrupted anima drop!", "taleyy",
    { kind: "drop", item: "Orb of corrupted anima" }],
  ["[21:00:00] Someone Else has received a Memory Dowser drop!", "taleyy", null],

  // level-ups (personal)
  ["[23:15:23] You've just advanced a virtual Defence level! You have reached level 104.", "taleyy",
    { kind: "levelup", skill: "defence", level: 104, virtual: true }],
  ["You've just advanced a Cooking level! You have reached level 74.", "taleyy",
    { kind: "levelup", skill: "cooking", level: 74, virtual: false }],
  ["You've just advanced a Necromancy level! You have reached level 90.", "taleyy",
    { kind: "levelup", skill: "necromancy", level: 90, virtual: false }],
  ["You've just advanced a Blorbo level! You have reached level 5.", "taleyy", null], // not a real skill

  // xp milestone (personal)
  ["[23:04:41] Well done! You've achieved 20,000,000 XP in Defence!", "taleyy",
    { kind: "xp", skill: "defence", xp: 20000000 }],

  // 99 / 120 broadcasts (need RSN)
  ["[23:04:36] Leagues: ⤷taleyy has achieved 99 Cooking!", "taleyy",
    { kind: "skill99", skill: "cooking" }],
  ["[23:16:57] Leagues: ⤷taleyy has just achieved 120 Strength!", "taleyy",
    { kind: "skill120", skill: "strength" }],
  ["[23:16:57] Leagues: ⤷Someone Else has just achieved 120 Strength!", "taleyy", null],

  // feats
  ["[23:19:38] Leagues: ⤷taleyy has just achieved at least level 99 in all skills!", "taleyy",
    { kind: "feat" }],
  ["[23:23:29] *News: taleyy has achieved 200 million XP in Agility!", "taleyy",
    { kind: "feat" }],

  // titles
  ["[20:14:01] *News: taleyy has unlocked the 'Jack of All Blades' title!", "taleyy",
    { kind: "title", title: "Jack of All Blades" }],
  ["[20:14:01] *News: taleyy has unlocked the golden 'Floorgazer' title!", "taleyy",
    { kind: "title", title: "Floorgazer", flavour: "golden" }],

  // clue
  ["[21:00:00] *News: taleyy completed a Treasure Trail and received Third age longsword!", "taleyy",
    { kind: "clue", item: "Third age longsword" }],

  // not our RSN and no personal marker
  ["[23:04:36] Leagues: ⤷GIMCappy has achieved 99 Cooking!", "taleyy", null],
];

let failures = 0;
for (const [line, rsn, expect] of cases) {
  const got = parseLine(line, rsn);
  let ok = true;
  if (expect === null) ok = got === null;
  else if (!got) ok = false;
  else ok = Object.entries(expect).every(([k, v]) => got[k] === v);

  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(line)}`);
  console.log(`      norm: ${JSON.stringify(normalize(line))}`);
  console.log(`      want: ${JSON.stringify(expect)}`);
  console.log(`      got : ${JSON.stringify(got)}`);
  if (got) console.log(`      keys: ${JSON.stringify(dedupKeys(got, rsn))}`);
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
