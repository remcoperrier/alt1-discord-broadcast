// Quick sanity check for the chat-line matcher. Run: npm run check
import { parseLine, dedupKeys, normalize } from "../src/matcher.ts";

/** [line, rsn, expect]  expect: null | { item, qty, type } */
const cases = [
  ["[20:11:29] *News: GlaZsz has received a Memory Dowser drop!", "GlaZsz",
    { item: "Memory Dowser", qty: 1, type: "drop" }],
  ["[20:14:01] *News: UtterlyComp has unlocked the 'Jack of All Blades' title!", "UtterlyComp",
    null],
  ["[20:15:32] *News: BRB CATS DED has received Bubbles, the Fishing pet drop at 6,166,677 XP!", "BRB CATS DED",
    { item: "Bubbles", qty: 1, type: "pet" }],
  ["[20:28:31] *News: Woutersays has achieved 200 million XP in Divination!", "Woutersays",
    null],
  ["⇝ gago has received a Soulbound lantern drop!", "gago",
    { item: "Soulbound lantern", qty: 1, type: "drop" }],
  ["catsleep has received some gloves of subjugation drop!", "catsleep",
    { item: "gloves of subjugation", qty: 1, type: "drop" }],
  ["[19:02:11] Wintery High has received a rare drop: Zamorak hilt", "Wintery High",
    { item: "Zamorak hilt", qty: 1, type: "drop" }],
  ["[21:00:00] Someone Else has received a Memory Dowser drop!", "GlaZsz",
    null],
  ["[21:00:03] GlaZsz has received 15,000 x Onyx bolts drop!", "GlaZsz",
    { item: "Onyx bolts", qty: 15000, type: "drop" }],
];

let failures = 0;
for (const [line, rsn, expect] of cases) {
  const ev = parseLine(line, rsn);
  const got = ev ? { item: ev.item, qty: ev.qty, type: ev.type } : null;
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(line)}`);
  console.log(`      norm: ${JSON.stringify(normalize(line))}`);
  console.log(`      want: ${JSON.stringify(expect)}`);
  console.log(`      got : ${JSON.stringify(got)}`);
  if (ev) console.log(`      keys: ${JSON.stringify(dedupKeys(ev, rsn))}`);
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
