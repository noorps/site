import { LISTINGS, PROVIDERS, CATEGORY_LABELS } from "./inventory.js";
import { buildChecklist, matchListings } from "./checklist.js";
import { SAMPLE_SCRIPT } from "./sample.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const byId = Object.fromEntries(LISTINGS.map((l) => [l.id, l]));

const ICONS = {
  props: '<path d="M9 20h22v12a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z"/><path d="M31 23h3a3 3 0 0 1 0 6h-3"/><path d="M15 8c0 3 3 3 3 6M21 8c0 3 3 3 3 6"/>',
  furniture: '<path d="M8 22v-6a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v6"/><path d="M6 22h28v7H6z"/><path d="M9 29v5M31 29v5"/>',
  set: '<path d="M6 34V10l14-4 14 4v24"/><path d="M15 34V22h10v12"/><path d="M6 34h28"/>',
  costumes: '<path d="M14 6l6 4 6-4 8 6-4 6-3-2v18H13V16l-3 2-4-6z"/>',
  lighting: '<path d="M20 5v4"/><circle cx="20" cy="17" r="7"/><path d="M16 24h8l-1 9h-6z"/><path d="M12 36h16"/>',
  sound: '<path d="M8 16h6l8-7v22l-8-7H8z"/><path d="M27 14a8 8 0 0 1 0 12M30 10a13 13 0 0 1 0 20"/>',
  effects: '<path d="M8 26a6 6 0 0 1 4-11 8 8 0 0 1 15-2 6 6 0 0 1 3 12z"/><path d="M12 31l-1 3M19 31l-1 3M26 31l-1 3"/>',
  other: '<rect x="9" y="9" width="22" height="22" rx="4"/><path d="M15 20h10M20 15v10"/>',
};
const icon = (cat) => `<svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[cat] || ICONS.other}</svg>`;
const rateText = (l) => (l.rate === 0 ? "Free to borrow" : `${money(l.rate)}/week`);

/* ---------- Request tray ---------- */
const requested = new Set();
function updateTray() {
  const tray = $("#tray");
  const n = requested.size;
  tray.hidden = n === 0;
  if (!n) return;
  const items = [...requested].map((id) => byId[id]);
  const rent = items.reduce((s, l) => s + l.rate, 0);
  const buy = items.reduce((s, l) => s + l.replace, 0);
  $("#tray-count").textContent = `${n} item${n === 1 ? "" : "s"}`;
  $("#tray-sum").textContent = `${money(rent)}/week to rent vs about ${money(buy)} to buy new`;
}
function toggleRequest(id, btn) {
  if (requested.has(id)) requested.delete(id);
  else requested.add(id);
  document.querySelectorAll(`[data-req="${id}"]`).forEach((b) => {
    const on = requested.has(id);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Requested" : "Request";
  });
  updateTray();
  btn?.blur?.();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-req]");
  if (btn) toggleRequest(btn.dataset.req, btn);
});
const reqButton = (id) => `<button type="button" class="req" data-req="${id}" aria-pressed="${requested.has(id)}">${requested.has(id) ? "Requested" : "Request"}</button>`;

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
  out.innerHTML = `<div class="loading"><p>Reading stage directions and dialogue...</p>${'<div class="skel"></div>'.repeat(5)}</div>`;
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
        const sub = [item.notes, scenes && `Appears in: ${scenes}`].filter(Boolean).map(esc).join(" · ");
        const m = matches.length
          ? `<div class="matches">${matches
              .map((l) => {
                const p = PROVIDERS[l.p];
                return `<div class="match"><div><div class="match-title">${esc(l.title)}</div><div class="match-where">${esc(p.name)} · ${esc(p.hood)} · ${p.miles} mi</div></div><div class="match-right"><span class="match-price">${rateText(l)}</span>${reqButton(l.id)}</div></div>`;
              })
              .join("")}</div>`
          : `<p class="nomatch">Nothing nearby yet. We'll ask our providers for you.</p>`;
        return `<div class="item"><div class="item-top"><span class="item-name">${esc(item.name)}</span><span class="qty">× ${Number(item.quantity) || 1}</span>${item.priority === "essential" ? '<span class="tag">Essential</span>' : '<span class="tag tag-soft">Nice to have</span>'}</div>${sub ? `<p class="item-sub">${sub}</p>` : ""}${m}</div>`;
      });
      return `<div class="cat-group"><p class="cat-title">${CATEGORY_LABELS[c]} (${groups[c].length})</p>${rows.join("")}</div>`;
    })
    .join("");

  const via = result.source === "claude"
    ? `Checklist written by Claude in ${seconds.toFixed(1)}s.`
    : `Quick checklist from keyword matching (the AI reader is offline right now), so it may miss items a person would catch.`;

  out.innerHTML = `
    <div class="out-head">
      <div><h3>${esc(result.production_title || "Your production")}</h3><p class="out-meta">${items.length} items to source</p></div>
      <div class="out-stats">
        <div class="stat"><b>${matched}/${items.length}</b><span>Found nearby</span></div>
        <div class="stat"><b>${money(saved)}</b><span>Saved vs buying*</span></div>
      </div>
    </div>
    ${html}
    <p class="out-foot">${via} *Estimate for a four-week run against each item's cost to buy new, using sample pilot listings.</p>`;
}

/* ---------- Inventory browser ---------- */
const grid = $("#inv-grid");
const chips = $("#inv-chips");
const search = $("#inv-search");
let activeCat = "all";

const cats = ["all", ...Object.keys(CATEGORY_LABELS).filter((c) => LISTINGS.some((l) => l.cat === c))];
chips.innerHTML = cats
  .map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${c === "all"}">${c === "all" ? "All" : CATEGORY_LABELS[c]}</button>`)
  .join("");
chips.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  activeCat = b.dataset.cat;
  chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  renderGrid();
});
search.addEventListener("input", renderGrid);

function renderGrid() {
  const q = search.value.trim().toLowerCase();
  const list = LISTINGS.filter((l) => (activeCat === "all" || l.cat === activeCat) && (!q || `${l.title} ${l.tags.join(" ")} ${PROVIDERS[l.p].name}`.toLowerCase().includes(q)));
  grid.innerHTML = list
    .map((l) => {
      const p = PROVIDERS[l.p];
      return `<article class="card">
        <div class="card-art art-${l.cat}">${icon(l.cat)}</div>
        <div class="card-body">
          <div class="card-title">${esc(l.title)}</div>
          <div class="card-meta">${esc(p.name)} · ${esc(p.hood)}, ${p.miles} mi</div>
          <div class="card-meta">${esc(l.era === "Any" ? l.cond : `${l.era} · ${l.cond}`)}</div>
          <div class="card-foot"><span class="rate ${l.rate === 0 ? "rate-free" : ""}">${rateText(l)}</span><span class="save">~${money(l.replace)} new</span></div>
          <div style="margin-top:10px">${reqButton(l.id).replace('class="req"', 'class="req req-light"')}</div>
        </div>
      </article>`;
    })
    .join("");
  $("#inv-note").textContent = list.length
    ? `${list.length} of ${LISTINGS.length} sample listings from ${Object.keys(PROVIDERS).length} providers. Real pilot inventory replaces these as partners join.`
    : "Nothing matches that yet. Try a broader word, or tell us what you're looking for in the pilot form.";
}
renderGrid();

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
  if (requested.size) {
    data.note = `${data.note || ""}\n\nRequested in demo: ${[...requested].map((id) => byId[id].title).join("; ")}`.trim();
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
