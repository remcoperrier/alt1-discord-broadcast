// Grand Exchange lookup via the Weird Gloop API (runs the RS wiki).
// Docs: https://api.weirdgloop.org  ->  /exchange/history/rs/latest?name=<Item>
//
// Notes:
//  - `name` is case-sensitive and must match the GE item name (sentence case).
//  - Untradeable items (most pets) return an error object -> price/id are null.
//  - If the API is unreachable / CORS-blocked, we also resolve to nulls and the
//    embed simply shows "Unknown" for value and no thumbnail.

export interface ItemInfo {
  price: number | null;
  id: number | null;
}

const BASE = "https://api.weirdgloop.org/exchange/history/rs/latest";
const TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { info: ItemInfo; t: number }>();

export async function getItem(itemName: string): Promise<ItemInfo> {
  const key = itemName.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.info;

  const info: ItemInfo = { price: null, id: null };
  try {
    const res = await fetch(`${BASE}?name=${encodeURIComponent(itemName)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const entry = (data[itemName] ?? data[Object.keys(data)[0] ?? ""]) as
        | { price?: number; id?: number | string }
        | undefined;
      if (entry && typeof entry === "object") {
        if (typeof entry.price === "number") info.price = entry.price;
        const id = typeof entry.id === "string" ? parseInt(entry.id, 10) : entry.id;
        if (typeof id === "number" && Number.isFinite(id)) info.id = id;
      }
    }
  } catch {
    /* offline / blocked / not found -> leave nulls */
  }

  cache.set(key, { info, t: Date.now() });
  return info;
}

/** RS3 Grand Exchange item icon (large sprite) for a given item id. */
export function itemIconUrl(id: number): string {
  return `https://secure.runescape.com/m=itemdb_rs/obj_big.gif?id=${id}`;
}
