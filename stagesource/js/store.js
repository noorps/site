// Data layer for requests and listings.
// Talks to the Pages Functions API when it is deployed; otherwise runs in demo
// mode and keeps everything in this browser's localStorage, with the same shapes.
import { LISTINGS, PROVIDERS } from "./inventory.js?v=9";
import { quote } from "./pricing.js?v=9";

const KEY = "stagesource:v1";
let mode = null; // "api" | "local"

export const STATUS = {
  pending: { label: "Pending", hint: "Waiting on the provider" },
  approved: { label: "Approved", hint: "Confirmed. Pick up on your start date" },
  declined: { label: "Declined", hint: "Not available for these dates" },
  picked_up: { label: "Picked up", hint: "Out with the production" },
  returned: { label: "Returned", hint: "Back on the shelf. Thank you!" },
  cancelled: { label: "Cancelled", hint: "Cancelled by the production" },
};

// Which status changes each side may make.
export const PROVIDER_MOVES = { pending: ["approved", "declined"], approved: ["picked_up", "declined"], picked_up: ["returned"] };
export const RENTER_MOVES = { pending: ["cancelled"], approved: ["cancelled"] };

/* ---------- local storage ---------- */
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { requests: d.requests || [], listings: d.listings || [], mine: d.mine || [], tokens: d.tokens || {}, desk: d.desk || "", reviews: d.reviews || [] };
  } catch {
    return { requests: [], listings: [], mine: [], tokens: {}, desk: "", reviews: [] };
  }
}
function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode: demo still works for this page view */
  }
}

/* ---------- helpers shared with the API ---------- */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeId(prefix = "SS") {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${s}`;
}
export function weeksBetween(a, b) {
  const days = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  return Math.max(1, Math.ceil(days / 7));
}
export const listingById = (id) => LISTINGS.find((l) => l.id === id);

/** Group held listing ids into one draft request per provider. */
export function draftByProvider(ids, pickup, ret) {
  const weeks = pickup && ret ? weeksBetween(pickup, ret) : 1;
  const groups = {};
  for (const id of ids) {
    const l = listingById(id);
    if (!l) continue;
    (groups[l.p] ||= []).push({ listingId: l.id, title: l.title, rate: l.rate });
  }
  return Object.entries(groups).map(([providerId, items]) => ({
    providerId,
    items,
    weeks,
    estTotal: items.reduce((s, i) => s + i.rate * weeks, 0),
  }));
}

/* ---------- mode detection ---------- */
async function json(res) {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error("not json");
  return res.json();
}
export async function getMode() {
  if (mode) return mode;
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    mode = r.ok && (await json(r)).ok === true ? "api" : "local";
  } catch {
    mode = "local";
  }
  return mode;
}

/* ---------- listings ---------- */
let listingsLoaded = false;
/** Merge provider-added listings into the shared LISTINGS array (once per page). */
export async function loadListings() {
  if (listingsLoaded) return;
  listingsLoaded = true;
  let extra = [];
  if ((await getMode()) === "api") {
    try {
      extra = await json(await fetch("api/listings"));
    } catch {
      extra = [];
    }
  } else {
    extra = load().listings;
  }
  for (const l of extra) if (!LISTINGS.some((x) => x.id === l.id)) LISTINGS.push(l);
}

export async function addListing(listing, providerKey) {
  const clean = {
    title: String(listing.title || "").trim().slice(0, 120),
    cat: listing.cat,
    p: listing.p,
    rate: Math.max(0, Math.round(Number(listing.rate) || 0)),
    replace: Math.max(0, Math.round(Number(listing.replace) || 0)),
    era: String(listing.era || "Any").trim().slice(0, 30) || "Any",
    cond: String(listing.cond || "").trim().slice(0, 120),
    tags: String(listing.tags || "").toLowerCase().split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8),
  };
  if (!clean.title || !PROVIDERS[clean.p]) throw new Error("Give the item a name.");
  if ((await getMode()) === "api") {
    const r = await fetch("api/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...clean, key: providerKey }) });
    const j = await json(r);
    if (!r.ok) throw new Error(j.message || "Could not save the listing.");
    LISTINGS.push(j);
    return j;
  }
  const d = load();
  const item = { ...clean, id: makeId("U").toLowerCase(), added: new Date().toISOString() };
  if (!item.tags.length) item.tags = item.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  d.listings.push(item);
  save(d);
  LISTINGS.push(item);
  return item;
}

/* ---------- requests ---------- */
/**
 * Send requests for held listings. Returns the created requests (one per provider).
 * form: { production, contactName, contactEmail, pickup, return, note }
 */
export async function createRequests(ids, form) {
  if ((await getMode()) === "api") {
    const r = await fetch("api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, items: ids }) });
    const j = await json(r);
    if (!r.ok) throw new Error(j.message || "Could not send the requests.");
    const d = load();
    for (const req of j) {
      d.mine.push(req.id);
      d.tokens[req.id] = req.token;
    }
    save(d);
    return j;
  }
  const d = load();
  const now = new Date().toISOString();
  const created = draftByProvider(ids, form.pickup, form.return).map((g) => ({
    id: makeId(),
    createdAt: now,
    status: "pending",
    ...g,
    pickup: form.pickup,
    return: form.return,
    production: form.production,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    note: form.note || "",
    payment: null,
    history: [{ status: "pending", at: now, by: "production" }],
  }));
  d.requests.push(...created);
  d.mine.push(...created.map((r) => r.id));
  save(d);
  return created;
}

export async function myRequests() {
  const d = load();
  if (!d.mine.length) return [];
  if ((await getMode()) === "api") {
    const r = await fetch(`api/requests?ids=${encodeURIComponent(d.mine.join(","))}`, { cache: "no-store" });
    return (await json(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return d.requests.filter((r) => d.mine.includes(r.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function providerRequests(providerId, providerKey) {
  if ((await getMode()) === "api") {
    const r = await fetch(`api/requests?provider=${encodeURIComponent(providerId)}`, { headers: { "x-provider-key": providerKey || "" }, cache: "no-store" });
    const j = await json(r);
    if (!r.ok) throw new Error(j.message || "Could not load requests.");
    return j;
  }
  return load().requests.filter((r) => r.providerId === providerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Move a request to a new status. side: "provider" | "production". */
export async function updateStatus(id, status, side, { note = "", providerKey = "" } = {}) {
  if ((await getMode()) === "api") {
    const d = load();
    const r = await fetch(`api/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-provider-key": providerKey },
      body: JSON.stringify({ status, note, token: side === "production" ? d.tokens[id] : undefined }),
    });
    const j = await json(r);
    if (!r.ok) throw new Error(j.message || "Could not update the request.");
    return j;
  }
  const d = load();
  const req = d.requests.find((r) => r.id === id);
  if (!req) throw new Error("Request not found.");
  const allowed = (side === "provider" ? PROVIDER_MOVES : RENTER_MOVES)[req.status] || [];
  if (!allowed.includes(status)) throw new Error("That change isn't allowed right now.");
  req.status = status;
  req.history.push({ status, at: new Date().toISOString(), by: side, note: String(note).slice(0, 300) });
  save(d);
  return req;
}

/** Listing ids currently on hold or out (for the "on hold" mark in the inventory). */
export async function busyListingIds() {
  if ((await getMode()) === "api") return new Set();
  const busy = new Set();
  for (const r of load().requests) {
    if (["pending", "approved", "picked_up"].includes(r.status)) r.items.forEach((i) => busy.add(i.listingId));
  }
  return busy;
}

export function rememberDesk(providerId) {
  const d = load();
  d.desk = providerId;
  save(d);
}
export const lastDesk = () => load().desk;

/* ---------- payments ---------- */
const replaceOf = (id) => listingById(id)?.replace || 0;
export const quoteFor = (req, protection) => quote(req, { protection, replaceOf });

export async function getRequest(id) {
  if ((await getMode()) === "api") {
    const r = await fetch(`api/requests?ids=${encodeURIComponent(id)}`, { cache: "no-store" });
    return (await json(r))[0] || null;
  }
  return load().requests.find((r) => r.id === id) || null;
}

export const canPay = (r) => r && ["approved", "picked_up"].includes(r.status) && r.payment?.status !== "paid";

/** API mode: returns a Stripe Checkout URL to send the browser to. */
export async function startCheckout(id, protection) {
  const d = load();
  const back = new URL("pay.html", location.href).href;
  const r = await fetch("api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, token: d.tokens[id], protection, back }),
  });
  const j = await json(r);
  if (!r.ok) throw new Error(j.message || "Could not start checkout.");
  return j.url;
}

/** Demo mode: record a simulated payment. Nothing is charged and no card details exist. */
export async function payDemo(id, protection) {
  const d = load();
  const req = d.requests.find((r) => r.id === id);
  if (!canPay(req)) throw new Error("This request can't be paid right now.");
  const q = quoteFor(req, protection);
  const at = new Date().toISOString();
  req.payment = { status: "paid", method: "demo", amount: q.total, protection, quote: q, at, ref: makeId("PAY") };
  req.history.push({ status: req.status, at, by: "production", note: `Paid ${(q.total / 100).toFixed(2)} (demo)` });
  save(d);
  return req;
}

/* ---------- reviews ---------- */
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Someone";

export async function listReviews() {
  if ((await getMode()) === "api") {
    try {
      return await json(await fetch("api/reviews", { cache: "no-store" }));
    } catch {
      return [];
    }
  }
  return load().reviews.slice().sort((a, b) => b.at.localeCompare(a.at));
}

export async function addReview(requestId, { stars, text }) {
  stars = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
  text = String(text || "").trim().slice(0, 600);
  if (!text) throw new Error("Write a sentence or two.");
  if ((await getMode()) === "api") {
    const d = load();
    const r = await fetch("api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestId, token: d.tokens[requestId], stars, text }) });
    const j = await json(r);
    if (!r.ok) throw new Error(j.message || "Could not save the review.");
    d.reviewed = [...(d.reviewed || []), requestId];
    save(d);
    return j;
  }
  const d = load();
  const req = d.requests.find((r) => r.id === requestId);
  if (!req || req.status !== "returned") throw new Error("You can review a rental once it's returned.");
  if (d.reviews.some((v) => v.requestId === requestId)) throw new Error("You already reviewed this rental.");
  const review = { id: makeId("RV"), requestId, providerId: req.providerId, name: firstName(req.contactName), production: req.production, stars, text, at: new Date().toISOString() };
  d.reviews.push(review);
  save(d);
  return review;
}

export async function reviewedIds() {
  const d = load();
  return new Set([...(d.reviewed || []), ...d.reviews.map((v) => v.requestId)]);
}
