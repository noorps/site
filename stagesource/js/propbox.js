// Prop box: for shows with no script (improv, sketch, variety nights).
// Added after an interview with an improv performer at The Fallout Theater, who said her
// troupe would have used more props, and found more scenes, if borrowing them were easy.
// Picks versatile pieces from nearby inventory: free first, then cheapest, then closest.
import { LISTINGS, PROVIDERS } from "./inventory.js?v=12";

const POOLS = {
  // Open-ended objects that can be anything in a scene.
  improv: ["c02", "p12", "p05", "p01", "p03", "p08", "p15", "p14", "p13", "p11", "c01", "c08", "p07", "p16", "m01", "p06", "c06", "p04", "f10", "l03"],
  // Character pieces carry sketch: costumes first, a few anchor props.
  sketch: ["c02", "c01", "c04", "c03", "c06", "c05", "c08", "c07", "p01", "p05", "p03", "p13", "p12", "p15", "f10", "f03", "p14", "p11"],
  // A night of short acts needs sound, light and somewhere to sit.
  variety: ["a02", "a01", "l03", "l01", "e01", "f10", "f05", "f02", "c02", "p03", "p04", "l02"],
};

export const STYLE_LABEL = { improv: "Improv", sketch: "Sketch", variety: "Variety night" };

export function packBox({ style = "improv", cast = 6, budget = null } = {}) {
  const ids = POOLS[style] || POOLS.improv;
  const size = style === "variety" ? Math.min(ids.length, Math.max(6, cast + 4)) : Math.min(ids.length, Math.max(6, Math.min(16, cast * 2)));
  const pool = ids
    .map((id) => LISTINGS.find((l) => l.id === id))
    .filter(Boolean)
    .sort((a, b) => (b.rate === 0) - (a.rate === 0) || a.rate - b.rate || PROVIDERS[a.p].miles - PROVIDERS[b.p].miles);

  const items = [];
  let weekly = 0;
  const cap = budget != null && budget !== "" && Number(budget) >= 0 ? Number(budget) : Infinity;
  for (const l of pool) {
    if (items.length >= size) break;
    if (l.rate > 0 && weekly + l.rate > cap) continue;
    items.push(l);
    weekly += l.rate;
  }
  return {
    style,
    cast,
    items,
    weekly,
    buyNew: items.reduce((s, l) => s + l.replace, 0),
    free: items.filter((l) => l.rate === 0).length,
  };
}
