import { LISTINGS, PROVIDERS, CATEGORY_LABELS } from "./inventory.js?v=8";
import { providerRequests, updateStatus, addListing, getMode, loadListings, PROVIDER_MOVES, rememberDesk, lastDesk } from "./store.js?v=8";
import { slipCard, esc, money } from "./cards.js?v=8";

const $ = (s) => document.querySelector(s);
const sel = $("#desk-provider");
const keyInput = $("#desk-key");
let mode;

sel.innerHTML = Object.entries(PROVIDERS)
  .map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`)
  .join("");
$("#list-cat").innerHTML = Object.entries(CATEGORY_LABELS)
  .map(([id, label]) => `<option value="${id}">${label}</option>`)
  .join("");

const provider = () => sel.value;
const key = () => keyInput.value.trim();

/* ---------- tabs ---------- */
function show(pane) {
  document.querySelectorAll("[data-pane]").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.pane === pane)));
  document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.id !== `pane-${pane}`));
}
document.querySelectorAll("[data-pane]").forEach((t) => t.addEventListener("click", () => show(t.dataset.pane)));
document.querySelector('.tape[href="#list"]').addEventListener("click", (e) => {
  e.preventDefault();
  show("list");
  $("#pane-list input").focus();
});

/* ---------- requests ---------- */
async function renderIncoming() {
  const pane = $("#pane-incoming");
  let reqs;
  try {
    reqs = await providerRequests(provider(), key());
  } catch (err) {
    pane.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }
  const waiting = reqs.filter((r) => r.status === "pending");
  const out = reqs.filter((r) => ["approved", "picked_up"].includes(r.status));
  const done = reqs.filter((r) => ["returned", "declined", "cancelled"].includes(r.status));
  $("#count-incoming").textContent = waiting.length ? waiting.length : "";
  const earned = reqs.filter((r) => ["approved", "picked_up", "returned"].includes(r.status)).reduce((s, r) => s + r.estTotal, 0);
  $("#desk-stats").innerHTML = `<div><b>${waiting.length}</b><span>waiting</span></div><div><b>${out.length}</b><span>booked / out</span></div><div><b class="hot">${money(earned)}</b><span>booked revenue</span></div>`;

  if (!reqs.length) {
    pane.innerHTML = `<div class="rq-empty"><p class="empty-title">Quiet night</p><p class="empty-hand">no requests for ${esc(PROVIDERS[provider()].name)} yet</p><p class="rq-tip">Tip: hold a few of this provider's items on the <a href="./#inventory">inventory</a>, send the slip, then come back here.</p></div>`;
    return;
  }
  const section = (title, rs) =>
    rs.length ? `<p class="pl-cat">${title}<span>${rs.length}</span></p><div class="rq-grid">${rs.map((r) => slipCard(r, { side: "provider", moves: PROVIDER_MOVES[r.status] || [] })).join("")}</div>` : "";
  pane.innerHTML = section("Needs an answer", waiting) + section("Booked & out", out) + section("History", done);
}

$("#pane-incoming").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-move]");
  if (!b) return;
  let note = "";
  if (b.dataset.move === "declined") {
    note = prompt("Optional note to the production (why, or an alternative):", "") ?? null;
    if (note === null) return;
  }
  b.disabled = true;
  try {
    await updateStatus(b.dataset.id, b.dataset.move, "provider", { note, providerKey: key() });
  } catch (err) {
    alert(err.message);
  }
  renderIncoming();
});

/* ---------- shelf ---------- */
function renderShelf() {
  const mine = LISTINGS.filter((l) => l.p === provider());
  $("#count-listings").textContent = mine.length;
  $("#pane-listings").innerHTML = mine.length
    ? `<div class="tags">${mine
        .map(
          (l) => `<article class="tag">
        <div class="tag-lot"><span>Lot <b>${esc(l.id.toUpperCase())}</b></span><span>${l.added ? '<span class="tag-busy">new</span>' : esc(l.era === "Any" ? CATEGORY_LABELS[l.cat] : l.era)}</span></div>
        <h3 class="tag-title">${esc(l.title)}</h3>
        <p class="tag-meta">${esc(l.cond)}</p>
        <div class="tag-foot"><div><span class="tag-rate${l.rate === 0 ? " free" : ""}">${l.rate === 0 ? "Free" : money(l.rate)}</span><span class="tag-new">${l.rate === 0 ? "to borrow" : "per week"} · ~${money(l.replace)} new</span></div></div>
      </article>`,
        )
        .join("")}</div>`
    : `<div class="rq-empty"><p class="empty-title">Empty shelf</p><p class="empty-hand">list your first item →</p></div>`;
}

/* ---------- list an item ---------- */
$("#list-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#list-msg");
  const data = Object.fromEntries(new FormData(f));
  try {
    const item = await addListing({ ...data, p: provider() }, key());
    f.reset();
    f.rate.value = 10;
    msg.className = "form-msg ok";
    msg.innerHTML = `On the shelf as lot ${esc(item.id.toUpperCase())}. It now shows up in the <a href="./#inventory">inventory</a> and in script checklists.`;
    renderShelf();
  } catch (err) {
    msg.className = "form-msg bad";
    msg.textContent = err.message;
  }
});

/* ---------- boot ---------- */
async function refresh() {
  rememberDesk(provider());
  renderShelf();
  await renderIncoming();
}
sel.addEventListener("change", refresh);
keyInput.addEventListener("change", refresh);

(async () => {
  mode = await getMode();
  if (mode === "local") $("#demo-note").hidden = false;
  else $("#key-wrap").hidden = false;
  await loadListings();
  const last = lastDesk();
  if (last && PROVIDERS[last]) sel.value = last;
  await refresh();
})();
window.addEventListener("focus", () => renderIncoming());
