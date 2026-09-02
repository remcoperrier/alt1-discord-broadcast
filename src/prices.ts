// Grand Exchange price lookup via the Weird Gloop API (runs the RS wiki).
// Docs: https://api.weirdgloop.org  ->  /exchange/history/rs/latest?name=<Item>
//
// Notes:
//  - `name` is case-sensitive and must match the GE item name (sentence case).
//  - Untradeable items (most pets) return an error object -> we resolve to null.
//  - If the API is unreachable / CORS-blocked, we also resolve to null and the
//    embed simply shows "Unknown" for value.

const BASE = "https://api.weirdgloop.org/exchange/history/rs/latest";
const TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { price: number | null; t: number }>();

export async function getPrice(itemName: string): Promise<number | null> {
  const key = itemName.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.price;

  let price: number | null = null;
  try {
    const res = await fetch(`${BASE}?name=${encodeURIComponent(itemName)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const entry = (data[itemName] ?? data[Object.keys(data)[0] ?? ""]) as
        | { price?: number }
        | undefined;
      if (entry && typeof entry === "object" && typeof entry.price === "number") {
        price = entry.price;
      }
    }
  } catch {
    /* offline / blocked / not found -> leave price as null */
  }

  cache.set(key, { price, t: Date.now() });
  return price;
}
