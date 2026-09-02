import { displayItem, fmtShort, wikiUrl } from "./format";

export interface DropPost {
  rsn: string;
  item: string;
  qty: number;
  type: "drop" | "pet";
  /** GE value per item, or null if unknown / untradeable. */
  value: number | null;
  screenshot?: Blob | null;
}

const EMBED_COLOR = 0xc724b1; // magenta bar, like the reference embed

export function buildEmbed(p: DropPost): Record<string, unknown> {
  const name = displayItem(p.item);
  const url = wikiUrl(p.item);
  const unitTag = p.value != null ? ` (${fmtShort(p.value)})` : "";
  const total = p.value != null ? p.value * p.qty : null;

  const embed: Record<string, unknown> = {
    author: { name: p.rsn || "Unknown" },
    title: "Loot Drop",
    color: EMBED_COLOR,
    description:
      `${p.rsn || "Someone"} has received:\n\n` +
      `${p.qty} x [${name}](${url})${unitTag}`,
    fields: [
      {
        name: "Total Value",
        value: total != null ? `${fmtShort(total)} gp` : "Unknown",
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  if (p.screenshot) embed.image = { url: "attachment://drop.png" };
  return embed;
}

/** POST the drop to a Discord webhook. Uses multipart when a screenshot is attached. */
export async function postDrop(webhook: string, p: DropPost): Promise<Response> {
  const payload = { embeds: [buildEmbed(p)] };

  if (p.screenshot) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", p.screenshot, "drop.png");
    return fetch(webhook, { method: "POST", body: form });
  }

  return fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
