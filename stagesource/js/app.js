import { LISTINGS, PROVIDERS, CATEGORY_LABELS } from "./inventory.js?v=6";
import { buildChecklist, matchListings } from "./checklist.js?v=6";
import { SAMPLE_SCRIPT } from "./sample.js?v=6";
import { loadListings, listingById, busyListingIds, myRequests } from "./store.js?v=6";
import { openSlip } from "./slip.js?v=6";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Math.round(n).toLocaleString()}`;

const rateText = (l) => (l.rate === 0 ? "Free to borrow" : `${money(l.rate)}/week`);

/* ---------- Request tray ---------- */
const requested = new Set();
function updateTray() {
  const tray = $("#tray");
  const n = requested.size;
  tray.hidden = n === 0;
  if (!n) return;
  const items = [...requested].map(listingById).filter(Boolean);
  const rent = items.reduce((s, l) => s + l.rate, 0);
  const buy = items.reduce((s, l) => s + l.replace, 0);
  $("#tray-count").textContent = `${n} item${n === 1 ? "" : "s"}`;
  $("#tray-sum").textContent = `${money(rent)}/wk to rent · ~${money(buy)} to buy new`;
}
function toggleRequest(id, btn) {
  if (requested.has(id)) requested.delete(id);
  else requested.add(id);
  document.querySelectorAll(`[data-req="${id}"]`).forEach((b) => {
    const on = requested.has(id);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Added ✓" : "Request";
  });
  updateTray();
  btn?.blur?.();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-req]");
  if (btn) toggleRequest(btn.dataset.req, btn);
});
const reqButton = (id) => `<button type="button" class="req" data-req="${id}" aria-pressed="${requested.has(id)}">${requested.has(id) ? "Added ✓" : "Request"}</button>`;
function syncButtons() {
  document.querySelectorAll("[data-req]").forEach((b) => {
    const on = requested.has(b.dataset.req);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Added ✓" : "Request";
  });
}
$("#tray-send").addEventListener("click", () =>
  openSlip(requested, () => {
    syncButtons();
    updateTray();
    refreshBusy();
    refreshNavCount();
  }),
);

/* ---------- My requests count in the nav ---------- */
async function refreshNavCount() {
  const open = (await myRequests().catch(() => [])).filter((r) => ["pending", "approved", "picked_up"].includes(r.status)).length;
  const badge = $("#nav-req-count");
  badge.textContent = open;
  badge.hidden = open === 0;
}
refreshNavCount();

/* ---------- Script demo ---------- */
const scriptEl = $("#script");
const countEl = $("#char-count");
const out = $("#output");
const runBtn = $("#run");

const updateCount = () => (countEl.textContent = `${scriptEl.value.length.toLocaleString()} characters`);
scriptEl.addEventListener("input", updateCount);
$("#use-sample").addEventListener("click", () => {
  scriptEl.value = SAMPLE_SCRIPT;
  updateCount();
  scriptEl.focus();
});
$("#script-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 400_000) {
    out.innerHTML = `<p class="err">That file is over 400 KB. Paste one act at a time for now.</p>`;
    return;
  }
  scriptEl.value = await file.text();
  updateCount();
  e.target.value = "";
});

$("#script-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = scriptEl.value.trim();
  if (text.length < 40) {
    out.innerHTML = `<p class="err">Paste at least a few lines of a script, or use the sample.</p>`;
    return;
  }
  runBtn.disabled = true;
  runBtn.textContent = "Reading your script...";
  out.innerHTML = `<div class="loading"><p>reading the stage directions…</p>${'<div class="skel"></div>'.repeat(6)}</div>`;
  const started = performance.now();
  try {
    const result = await buildChecklist(text);
    renderChecklist(result, (performance.now() - started) / 1000);
  } catch (err) {
    out.innerHTML = `<p class="err">Something went wrong building the checklist. Try again.</p>`;
    console.error(err);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Build my checklist";
  }
});

function renderChecklist(result, seconds) {
  out.classList.toggle("has-result", !result.error && (result.items || []).length > 0);
  out.scrollTop = 0;
  if (result.error) {
    out.innerHTML = `<p class="err">${esc(result.error)}</p>`;
    return;
  }
  const items = result.items || [];
  if (!items.length) {
    out.innerHTML = `<p class="err">We couldn't find any physical items in that text. Scripts with stage directions work best.</p>`;
    return;
  }

  let matched = 0;
  let saved = 0;
  const groups = {};
  for (const item of items) {
    const matches = matchListings(item);
    if (matches.length) {
      matched++;
      saved += Math.max(0, matches[0].replace - matches[0].rate * 4);
    }
    (groups[item.category] ||= []).push({ item, matches });
  }

  const order = Object.keys(CATEGORY_LABELS);
  const html = order
    .filter((c) => groups[c])
    .map((c) => {
      const rows = groups[c].map(({ item, matches }) => {
        const scenes = (item.scenes || []).join(", ");
        const sub = [item.notes, scenes && `in ${scenes}`].filter(Boolean).map(esc).join(" · ");
        const m = matches.length
          ? `<div class="pl-matches">${matches
              .map((l) => {
                const p = PROVIDERS[l.p];
                return `<div class="pl-match"><div><span class="pl-m-title">${esc(l.title)}</span><span class="pl-m-where">${esc(p.name)} · ${esc(p.hood)} · ${p.miles} mi</span></div><span class="pl-m-price">${rateText(l)}</span>${reqButton(l.id)}</div>`;
              })
              .join("")}</div>`
          : `<p class="pl-none">nothing nearby yet, we'll ask around for you</p>`;
        return `<div class="pl-item"><span class="pl-box${matches.length ? " ticked" : ""}" aria-hidden="true"></span><div><span class="pl-name">${esc(item.name)}</span><span class="pl-qty">×${Number(item.quantity) || 1}</span>${item.priority === "essential" ? '<span class="pl-ess">essential!</span>' : ""}</div>${sub ? `<p class="pl-sub">${sub}</p>` : ""}${m}</div>`;
      });
      return `<p class="pl-cat">${CATEGORY_LABELS[c]}<span>${groups[c].length} item${groups[c].length === 1 ? "" : "s"}</span></p>${rows.join("")}`;
    })
    .join("");

  const via = result.source === "claude"
    ? `Checklist written by Claude in ${seconds.toFixed(1)}s.`
    : `Quick checklist from keyword matching (the AI reader is offline right now), so it may miss items a person would catch.`;

  out.innerHTML = `
    <div class="pl-head">
      <div><p class="pl-kicker">Props list · ${items.length} items to source</p><h3 class="pl-title">${esc(result.production_title || "Your production")}</h3></div>
      <div class="pl-stats">
        <div class="pl-stat"><b>${matched}/${items.length}</b><span>found nearby</span></div>
        <div class="pl-stat"><b class="hot">${money(saved)}</b><span>saved vs buying*</span></div>
      </div>
    </div>
    ${html}
    <p class="pl-foot">${via} *Estimate for a four-week run against each item's cost to buy new, using sample pilot listings.</p>`;
}

/* ---------- Inventory browser ---------- */
const grid = $("#inv-grid");
const chips = $("#inv-chips");
const search = $("#inv-search");
let activeCat = "all";
let busy = new Set();
async function refreshBusy() {
  busy = await busyListingIds();
  renderGrid();
}
let showAll = false;
const PREVIEW = matchMedia("(max-width: 600px)").matches ? 6 : 12;
const moreBtn = $("#inv-more");
moreBtn.addEventListener("click", () => { showAll = true; renderGrid(); });

const cats = ["all", ...Object.keys(CATEGORY_LABELS).filter((c) => LISTINGS.some((l) => l.cat === c))];
chips.innerHTML = cats
  .map((c) => `<button type="button" class="tab" data-cat="${c}" aria-pressed="${c === "all"}">${c === "all" ? "All" : CATEGORY_LABELS[c]}</button>`)
  .join("");
chips.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  activeCat = b.dataset.cat;
  chips.querySelectorAll(".tab").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  renderGrid();
});
search.addEventListener("input", renderGrid);

function renderGrid() {
  const q = search.value.trim().toLowerCase();
  const list = LISTINGS.filter((l) => (activeCat === "all" || l.cat === activeCat) && (!q || `${l.title} ${l.tags.join(" ")} ${PROVIDERS[l.p].name}`.toLowerCase().includes(q)));
  const browsing = activeCat === "all" && !q && !showAll;
  moreBtn.hidden = !browsing || list.length <= PREVIEW;
  if (!moreBtn.hidden) moreBtn.textContent = `Show all ${list.length} listings`;
  grid.innerHTML = (browsing ? list.slice(0, PREVIEW) : list)
    .map((l) => {
      const p = PROVIDERS[l.p];
      return `<article class="tag">
        <div class="tag-lot"><span>Lot <b>${l.id.toUpperCase()}</b></span><span>${busy.has(l.id) ? '<span class="tag-busy">on hold</span>' : esc(l.era === "Any" ? CATEGORY_LABELS[l.cat] : l.era)}</span></div>
        <h3 class="tag-title">${esc(l.title)}</h3>
        <p class="tag-meta">${esc(p.name)}<br>${esc(p.hood)} · ${p.miles} mi</p>
        <p class="tag-meta">${esc(l.cond)}</p>
        <div class="tag-foot"><div><span class="tag-rate${l.rate === 0 ? " free" : ""}">${l.rate === 0 ? "Free" : money(l.rate)}</span><span class="tag-new">${l.rate === 0 ? "to borrow" : "per week"} · ~${money(l.replace)} new</span></div>${reqButton(l.id)}</div>
      </article>`;
    })
    .join("");
  $("#inv-note").textContent = list.length
    ? `${list.length} of ${LISTINGS.length} listings from ${Object.keys(PROVIDERS).length} providers. Sample inventory until pilot partners join.`
    : "Nothing matches that yet. Try a broader word, or tell us what you're looking for in the pilot form.";
}
renderGrid();
loadListings().then(refreshBusy);

/* ---------- Pilot form ---------- */
const form = $("#pilot-form");
const msg = $("#pilot-msg");
document.querySelectorAll("[data-role]").forEach((a) =>
  a.addEventListener("click", () => {
    const r = form.querySelector(`input[name=role][value="${a.dataset.role}"]`);
    if (r) r.checked = true;
  }),
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (!data.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || "")) {
    msg.className = "form-msg bad";
    msg.textContent = "Add your name and a valid email.";
    return;
  }
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const res = await fetch("api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    // Only trust a JSON {ok:true}; static hosts can answer unknown paths with HTML and a 200.
    const j0 = res.ok ? await res.clone().json().catch(() => null) : null;
    if (j0?.ok === true) {
      form.reset();
      msg.className = "form-msg ok";
      msg.textContent = "You're on the list. We'll be in touch within a week.";
      return;
    }
    if (res.status === 400) {
      const j = await res.json().catch(() => ({}));
      msg.className = "form-msg bad";
      msg.textContent = j.message || "Check the form and try again.";
      return;
    }
    throw new Error(`status ${res.status}`);
  } catch {
    const body = encodeURIComponent(`Name: ${data.name}\nOrg: ${data.org || ""}\nRole: ${data.role}\n\n${data.note || ""}`);
    msg.className = "form-msg bad";
    msg.innerHTML = `Sign-ups aren't saving right now. <a href="mailto:purnoor.sharma@utexas.edu?subject=StageSource%20pilot&body=${body}">Email us instead</a>.`;
  } finally {
    btn.disabled = false;
  }
});
