// The request slip: review held items, pick dates, send one request per provider.
import { PROVIDERS } from "./inventory.js?v=8";
import { draftByProvider, createRequests, getMode, listingById } from "./store.js?v=8";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const iso = (d) => d.toISOString().slice(0, 10);

let dialog;
let state; // { held: Set, onChange: fn }

function el() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "slip";
  dialog.setAttribute("aria-labelledby", "slip-title");
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // backdrop
    const rm = e.target.closest("[data-unhold]");
    if (rm) {
      state.held.delete(rm.dataset.unhold);
      state.onChange();
      if (!state.held.size) dialog.close();
      else render();
    }
    if (e.target.closest("[data-close]")) dialog.close();
  });
  dialog.addEventListener("input", (e) => {
    if (e.target.name === "pickup" || e.target.name === "return") renderSummary();
  });
  dialog.addEventListener("submit", onSubmit);
  return dialog;
}

function formValues() {
  const f = dialog.querySelector("form");
  return f ? Object.fromEntries(new FormData(f)) : {};
}

function renderSummary() {
  const v = formValues();
  const groups = draftByProvider([...state.held], v.pickup, v.return);
  const total = groups.reduce((s, g) => s + g.estTotal, 0);
  const weeks = groups[0]?.weeks || 1;
  const box = dialog.querySelector("#slip-summary");
  if (box) {
    box.innerHTML = `<span>${groups.length} request${groups.length === 1 ? "" : "s"} to ${groups.length} provider${groups.length === 1 ? "" : "s"} · ${weeks} week${weeks === 1 ? "" : "s"}</span><b>${money(total)}</b>`;
  }
}

async function render() {
  const groups = draftByProvider([...state.held]);
  const today = new Date();
  const start = new Date(today.getTime() + 7 * 86400000);
  const end = new Date(today.getTime() + 34 * 86400000);
  const demo = (await getMode()) === "local";
  const prev = formValues();

  dialog.innerHTML = `
    <form class="slip-form" novalidate>
      <header class="slip-head">
        <div><p class="slip-kicker">Rental request slip</p><h2 id="slip-title" class="slip-title">Review &amp; send</h2></div>
        <button type="button" class="slip-x" data-close aria-label="Close">×</button>
      </header>
      ${demo ? `<p class="slip-demo">Demo mode: requests are saved in this browser and you can play the provider at the <a href="desk.html">provider desk</a>.</p>` : ""}

      <div class="slip-groups">
        ${groups
          .map((g) => {
            const p = PROVIDERS[g.providerId];
            return `<section class="slip-group">
              <p class="slip-prov">${esc(p.name)} <span>${esc(p.hood)} · ${p.miles} mi</span></p>
              ${g.items
                .map((i) => {
                  const l = listingById(i.listingId);
                  return `<div class="slip-item"><span>${esc(i.title)}</span><span class="slip-rate">${i.rate ? `${money(i.rate)}/wk` : "Free"}</span><button type="button" class="slip-rm" data-unhold="${i.listingId}" aria-label="Remove ${esc(l?.title || i.title)}">remove</button></div>`;
                })
                .join("")}
            </section>`;
          })
          .join("")}
      </div>

      <div class="slip-fields">
        <label class="line">Pick up<input type="date" name="pickup" required value="${esc(prev.pickup || iso(start))}" min="${iso(today)}"></label>
        <label class="line">Return<input type="date" name="return" required value="${esc(prev.return || iso(end))}" min="${iso(today)}"></label>
        <label class="line span2">Production<input name="production" required placeholder="The Last Train to Lockhart" value="${esc(prev.production || "")}"></label>
        <label class="line">Your name<input name="contactName" required autocomplete="name" value="${esc(prev.contactName || "")}"></label>
        <label class="line">Email<input name="contactEmail" type="email" required autocomplete="email" value="${esc(prev.contactEmail || "")}"></label>
        <label class="line span2">Note to providers <span class="opt">(optional)</span><textarea name="note" rows="2" placeholder="Show dates, how you'll transport it…">${esc(prev.note || "")}</textarea></label>
      </div>

      <div class="slip-summary" id="slip-summary"></div>
      <div class="slip-actions">
        <button class="btn" type="submit">Send requests <span aria-hidden="true">→</span></button>
        <p class="form-msg" id="slip-msg" role="status"></p>
      </div>
    </form>`;
  renderSummary();
}

async function onSubmit(e) {
  e.preventDefault();
  const v = formValues();
  const msg = dialog.querySelector("#slip-msg");
  const bad = (t) => {
    msg.className = "form-msg bad";
    msg.textContent = t;
  };
  if (!v.pickup || !v.return || v.return < v.pickup) return bad("Pick a return date on or after the pickup date.");
  if (!v.production?.trim()) return bad("Name the production.");
  if (!v.contactName?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail || "")) return bad("Add your name and a valid email.");

  const btn = dialog.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const created = await createRequests([...state.held], v);
    state.held.clear();
    state.onChange();
    dialog.innerHTML = `
      <div class="slip-done">
        <span class="stamp stamp-inline">Sent</span>
        <h2 class="slip-title">${created.length} request${created.length === 1 ? "" : "s"} on their way.</h2>
        <p>Each provider approves their part. You'll see every status change on your requests page.</p>
        <ul class="slip-ids">${created.map((r) => `<li><b>${esc(r.id)}</b> ${esc(PROVIDERS[r.providerId].name)}</li>`).join("")}</ul>
        <div class="slip-actions"><a class="btn" href="requests.html">Track my requests <span aria-hidden="true">→</span></a><button type="button" class="text-link" data-close>keep browsing</button></div>
      </div>`;
  } catch (err) {
    bad(err.message || "Something went wrong. Try again.");
    btn.disabled = false;
  }
}

export async function openSlip(held, onChange) {
  state = { held, onChange };
  el();
  await render();
  dialog.showModal();
}
