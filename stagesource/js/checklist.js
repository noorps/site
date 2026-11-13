// Checklist building and inventory matching.
// buildChecklist() asks the server (Claude) first and falls back to a
// keyword pass in the browser so the demo still works without the API.
import { LISTINGS, PROVIDERS } from "./inventory.js?v=10";

// Keyword fallback: [display name, category, terms...]
const LEXICON = [
  ["Telephone", "props", "rotary phone", "telephone", "phone rings", "the phone"],
  ["Typewriter", "props", "typewriter"],
  ["Wine glasses", "props", "wine glass", "wine glasses", "glasses of wine", "glass of wine", "goblet"],
  ["Wine bottle", "props", "bottle of wine", "wine bottle", "bottle"],
  ["Suitcase", "props", "suitcase", "valise", "luggage"],
  ["Trunk", "props", "trunk", "steamer trunk"],
  ["Candlesticks", "props", "candlestick", "candlesticks", "candelabra", "candle", "candles"],
  ["Books", "props", "book", "books", "ledger", "diary", "journal"],
  ["Prop gun (non-firing)", "props", "revolver", "pistol", "gun"],
  ["Breakaway bottle", "effects", "smashes a bottle", "breaks a bottle", "breakaway"],
  ["Crutches", "props", "crutch", "crutches"],
  ["Cane", "props", "cane", "walking stick"],
  ["Tea service", "props", "teapot", "tea set", "teacup", "teacups", "cup of tea", "tea"],
  ["Pocket watch", "props", "pocket watch", "pocketwatch"],
  ["Newspaper", "props", "newspaper", "newspapers", "the paper"],
  ["Radio", "sound", "radio", "wireless set"],
  ["Letter / envelope", "props", "letter", "envelope", "telegram"],
  ["Keys", "props", "keys", "key ring"],
  ["Flowers", "props", "bouquet", "flowers", "roses"],
  ["Cigarette case", "props", "cigarette case", "cigarette", "lighter"],
  ["Chaise lounge", "furniture", "chaise", "fainting couch", "daybed"],
  ["Sofa", "furniture", "sofa", "couch", "settee"],
  ["Kitchen table and chairs", "furniture", "kitchen table", "dining table", "table"],
  ["Chairs", "furniture", "chair", "chairs", "stool"],
  ["Armchair", "furniture", "armchair", "wingback"],
  ["Desk", "furniture", "desk", "writing desk"],
  ["Bed", "furniture", "bed", "cot"],
  ["Bar cart", "furniture", "bar cart", "drinks cart", "sideboard"],
  ["Pews or benches", "furniture", "pew", "pews", "bench", "benches"],
  ["Piano", "furniture", "piano"],
  ["Floor lamp (practical)", "lighting", "floor lamp", "lamp"],
  ["Lantern", "lighting", "lantern", "oil lamp"],
  ["String lights", "lighting", "string lights", "fairy lights"],
  ["Spotlight special", "lighting", "spotlight", "a single light", "pool of light"],
  ["Door unit", "set", "door", "doorway"],
  ["Window unit", "set", "window"],
  ["Staircase", "set", "stairs", "staircase", "staircase unit"],
  ["Platforms / risers", "set", "platform", "riser", "balcony"],
  ["Backdrop", "set", "backdrop", "night sky", "skyline"],
  ["Trench coat", "costumes", "trench coat", "trenchcoat", "overcoat", "raincoat"],
  ["Hats", "costumes", "fedora", "hat", "bonnet"],
  ["Dress", "costumes", "dress", "gown", "frock"],
  ["Suit", "costumes", "suit", "waistcoat", "tuxedo"],
  ["Uniform", "costumes", "uniform", "police officer", "policeman", "nurse"],
  ["Jewelry", "costumes", "pearls", "necklace", "ring", "earrings"],
  ["Robes", "costumes", "robe", "robes", "dressing gown"],
  ["Fog / haze", "effects", "fog", "haze", "smoke", "mist"],
  ["Rain effect", "effects", "rain", "downpour", "storm"],
  ["Snow effect", "effects", "snow", "snowing"],
  ["Thunder", "sound", "thunder"],
  ["Microphones", "sound", "microphone", "mic"],
  ["Mannequin", "other", "mannequin", "dress form"],
];

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, pair: 2, couple: 2 };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function localChecklist(text) {
  const lines = text.split(/\r?\n/);
  let scene = "Opening";
  const found = new Map();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^(act\s+\w+.*|scene\s+\w+.*|int\.\s.*|ext\.\s.*)$/i);
    if (heading && line.length < 80) {
      // "SCENE 1. A boarding house parlor..." -> "Scene 1"; screenplay sluglines kept short.
      const label = /^(act|scene)/i.test(line) ? line.split(/[.:\-–—]/)[0] : line.slice(0, 40);
      scene = label.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      continue;
    }
    const isDirection = /^[([]/.test(line) || /^_.*_$/.test(line);
    const lower = line.toLowerCase();

    for (const [name, cat, ...terms] of LEXICON) {
      for (const term of terms) {
        const m = new RegExp(`\\b${esc(term)}\\b`, "i").exec(lower);
        if (!m) continue;
        // Quantity from the few words before the match ("pours two glasses", "a pair of candlesticks").
        const before = lower.slice(Math.max(0, m.index - 30), m.index).split(/[^a-z0-9]+/).filter(Boolean).slice(-3);
        let qty = 1;
        for (const w of before) {
          if (/^\d+$/.test(w)) qty = parseInt(w, 10);
          else if (NUMBER_WORDS[w] > 1) qty = NUMBER_WORDS[w];
        }
        const prev = found.get(name) || { name, category: cat, quantity: 1, scenes: [], notes: "", priority: "nice_to_have", search_terms: terms.slice(0, 3) };
        prev.quantity = Math.max(prev.quantity, Math.min(qty, 50));
        if (!prev.scenes.includes(scene)) prev.scenes.push(scene);
        if (isDirection) prev.priority = "essential";
        found.set(name, prev);
        break;
      }
    }
  }

  // "Chairs" double-counts when a table set already covers it.
  if (found.has("Kitchen table and chairs")) found.delete("Chairs");
  const order = ["props", "furniture", "set", "costumes", "lighting", "sound", "effects", "other"];
  const items = [...found.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return { source: "local", production_title: guessTitle(lines), items };
}

function guessTitle(lines) {
  const first = lines.map((l) => l.trim()).find(Boolean) || "";
  return first.length && first.length < 70 && !/^[([]/.test(first) ? first.replace(/^title:\s*/i, "") : "Your production";
}

function words(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

export function matchListings(item, limit = 2) {
  const terms = new Set([...(item.search_terms || []).map((t) => t.toLowerCase()), item.name.toLowerCase(), ...words(item.name)]);
  const scored = [];
  for (const l of LISTINGS) {
    let score = 0;
    const title = l.title.toLowerCase();
    for (const t of terms) {
      if (l.tags.includes(t)) score += t.includes(" ") ? 4 : 3;
      else if (t.length > 3 && title.includes(t)) score += 2;
    }
    if (score > 0 && l.cat === item.category) score += 1;
    if (score >= 3) scored.push({ l, score });
  }
  scored.sort((a, b) => b.score - a.score || PROVIDERS[a.l.p].miles - PROVIDERS[b.l.p].miles);
  // Keep runner-up matches only if they are as relevant as the best one or the same kind of thing.
  const best = scored[0];
  return scored
    .filter((s, i) => i === 0 || s.score >= best.score || s.l.cat === best.l.cat)
    .slice(0, limit)
    .map((s) => s.l);
}

export async function buildChecklist(text) {
  try {
    const res = await fetch("api/checklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && Array.isArray(data.items)) return data;
    // Errors the user should see (too long, rate limited) are passed through.
    if (data && ["too_short", "too_long", "rate_limited", "refused"].includes(data.error)) {
      return { error: data.message };
    }
  } catch {
    // Network error or static hosting with no functions: fall through.
  }
  return localChecklist(text);
}
