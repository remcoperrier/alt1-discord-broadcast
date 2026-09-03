import type { GameEvent } from "./matcher";
import { displayItem, fmtShort, wikiUrl } from "./format";

export interface PostContext {
  rsn: string;
  /** GE value per item for drops / clue rewards, or null. */
  value?: number | null;
  screenshot?: Blob | null;
}

const COLOR: Record<GameEvent["kind"], number> = {
  drop: 0xc724b1, // magenta
  levelup: 0x4ade80, // green
  xp: 0x38bdf8, // blue
  skill99: 0xfacc15, // gold
  skill120: 0xf59e0b, // amber
  feat: 0xa78bfa, // purple
  title: 0xa78bfa, // purple
  quest: 0x2dd4bf, // teal
  areatask: 0xfb923c, // orange
  clue: 0xfde047, // yellow
};

function skillUrl(skill: string): string {
  return wikiUrl(displayItem(skill));
}

function titleFor(ev: GameEvent): string {
  switch (ev.kind) {
    case "drop": return "Loot Drop";
    case "levelup": return ev.virtual ? "Virtual Level" : "Level Up";
    case "xp": return "XP Milestone";
    case "skill99": return "Skill Mastered";
    case "skill120": return "Skill Mastered";
    case "feat": return "Achievement";
    case "title": return "Title Unlocked";
    case "quest": return "Quest Complete";
    case "areatask": return "Area Tasks";
    case "clue": return "Treasure Trail";
  }
}

function bodyFor(ev: GameEvent, ctx: PostContext): { description: string; fields?: unknown[] } {
  const who = ctx.rsn || "Someone";
  switch (ev.kind) {
    case "drop": {
      const name = displayItem(ev.item);
      const tag = ctx.value != null ? ` (${fmtShort(ctx.value)})` : "";
      const total = ctx.value != null ? ctx.value * ev.qty : null;
      return {
        description: `${who} has received:\n\n${ev.qty} x [${name}](${wikiUrl(name)})${tag}`,
        fields: [
          {
            name: "Total Value",
            value: total != null ? `${fmtShort(total)} gp` : "Unknown",
            inline: true,
          },
        ],
      };
    }
    case "levelup":
      return {
        description:
          `${who} has reached ${ev.virtual ? "virtual " : ""}level **${ev.level}** ` +
          `in [${displayItem(ev.skill)}](${skillUrl(ev.skill)})!`,
      };
    case "xp":
      return {
        description:
          `${who} has reached **${fmtShort(ev.xp)} XP** ` +
          `in [${displayItem(ev.skill)}](${skillUrl(ev.skill)})!`,
      };
    case "skill99":
      return {
        description: `${who} has achieved **level 99** in [${displayItem(ev.skill)}](${skillUrl(ev.skill)})!`,
      };
    case "skill120":
      return {
        description: `${who} has achieved **level 120** in [${displayItem(ev.skill)}](${skillUrl(ev.skill)})!`,
      };
    case "feat":
      return { description: `${who} has achieved **${ev.text}**!` };
    case "title":
      return {
        description:
          `${who} has unlocked the ${ev.flavour ? ev.flavour + " " : ""}` +
          `**'${ev.title}'** title!`,
      };
    case "quest":
      return {
        description: `${who} has completed the quest [**${ev.quest}**](${wikiUrl(ev.quest)})!`,
      };
    case "areatask": {
      const label = `${ev.tier ? cap(ev.tier) + " " : ""}${displayItem(ev.area)} achievements`;
      return {
        description: `${who} has completed the [**${label}**](${wikiUrl(ev.area + " achievements")})!`,
      };
    }
    case "clue": {
      const name = displayItem(ev.item);
      const tag = ctx.value != null ? ` (${fmtShort(ctx.value)})` : "";
      return {
        description: `${who} completed a Treasure Trail and received [${name}](${wikiUrl(name)})${tag}!`,
      };
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildEmbed(ev: GameEvent, ctx: PostContext): Record<string, unknown> {
  const { description, fields } = bodyFor(ev, ctx);
  const embed: Record<string, unknown> = {
    author: { name: ctx.rsn || "Unknown" },
    title: titleFor(ev),
    color: COLOR[ev.kind],
    description,
    timestamp: new Date().toISOString(),
  };
  if (fields) embed.fields = fields;
  if (ctx.screenshot) embed.image = { url: "attachment://drop.png" };
  return embed;
}

/** POST an event to a Discord webhook. Uses multipart when a screenshot is attached. */
export async function postEvent(
  webhook: string,
  ev: GameEvent,
  ctx: PostContext,
): Promise<Response> {
  const payload = { embeds: [buildEmbed(ev, ctx)] };

  if (ctx.screenshot) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", ctx.screenshot, "drop.png");
    return fetch(webhook, { method: "POST", body: form });
  }

  return fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
