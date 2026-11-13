import { PROVIDERS } from "./inventory.js?v=9";
import { getRequest, getMode, loadListings, quoteFor, canPay, startCheckout, payDemo } from "./store.js?v=9";
import { dollars, PROTECTION_RATE } from "./pricing.js?v=9";
import { esc } from "./cards.js?v=9";

const root = document.getElementById("pay-root");
const params = new URLSearchParams(location.search);
const id = params.get("id");
let protection = true;
let mode;

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function lines(r, q) {
  return `
    <ul class="bo-lines">
      ${r.items.map((i) => `<li><span>${esc(i.title)}<small>${i.rate ? `${dollars(i.rate * 100)} × ${r.weeks} wk` : "free to borrow"}</small></span><b>${dollars(i.rate * 100 * r.weeks)}</b></li>`).join("")}
    </ul>
    <dl class="bo-sum">
      <div><dt>Rental subtotal</dt><dd>${dollars(q.subtotal)}</dd></div>
      <div><dt>Service fee <small>10%</small></dt><dd>${dollars(q.serviceFee)}</dd></div>
      <div><dt>Damage protection <small>${Math.round(PROTECTION_RATE * 100)}% of ${dollars(q.replaceValue)} replacement value</small></dt><dd>${q.protectionFee ? dollars(q.protectionFee) : "—"}</dd></div>
      <div class="bo-total"><dt>Total</dt><dd>${dollars(q.total)}</dd></div>
    </dl>`;
}

function ticket(r, inner, stub) {
  const p = PROVIDERS[r.providerId];
  return `<article class="ticket bo">
    <div class="t-main">
      <p class="t-kicker">Admit one production · slip ${esc(r.id)}</p>
      <h3 class="bo-title">${esc(r.production)}</h3>
      <p class="bo-meta">${esc(p.name)} · ${esc(p.hood)}<br>${fmtDate(r.pickup)} → ${fmtDate(r.return)} · ${r.weeks} week${r.weeks === 1 ? "" : "s"}</p>
      ${inner}
    </div>
    <div class="t-stub" aria-hidden="true"><span>${stub}</span><span>Box office</span></div>
  </article>`;
}

function renderPaid(r) {
  const pay = r.payment;
  const q = pay.quote || quoteFor(r, pay.protection);
  root.innerHTML = `<div class="bo-wrap">
    ${ticket(r, `${lines(r, q)}<span class="stamp stamp-inline bo-stamp">Paid</span>
      <p class="bo-note">Paid ${new Date(pay.at).toLocaleString()} · ref ${esc(pay.ref || pay.session || "")}${pay.method === "demo" ? " · demo, nothing was charged" : ""}</p>
      <div class="cta-row"><a class="btn" href="requests.html">Back to my requests <span aria-hidden="true">→</span></a></div>`, "Paid")}
  </div>`;
}

function renderCheckout(r) {
  const q = quoteFor(r, protection);
  const demo = mode === "local";
  if (q.total === 0) {
    root.innerHTML = `<div class="bo-wrap">${ticket(r, `${lines(r, q)}<p class="bo-note">Everything on this slip is free to borrow, so there's nothing to pay. Pick it up on ${fmtDate(r.pickup)}.</p>
      <label class="box bo-protect"><input type="checkbox" id="protect"><span>Add damage protection anyway</span></label>`, "Free")}</div>`;
    root.querySelector("#protect").addEventListener("change", (e) => {
      protection = e.target.checked;
      renderCheckout(r);
    });
    return;
  }
  root.innerHTML = `<div class="bo-wrap">
    ${ticket(
      r,
      `${lines(r, q)}
      <label class="box bo-protect"><input type="checkbox" id="protect" ${protection ? "checked" : ""}><span>Damage protection: covers accidental damage up to the replacement value</span></label>
      ${demo ? `<p class="slip-demo">Demo mode: no card is charged and no card details are collected. When the site is live, this button opens Stripe's secure checkout.</p>` : `<p class="bo-note">You'll finish on Stripe's secure checkout. Card details never touch StageSource.</p>`}
      <div class="cta-row"><button class="btn" id="pay-btn" type="button">${demo ? `Pay ${dollars(q.total)} (demo)` : `Pay ${dollars(q.total)} with Stripe`} <span aria-hidden="true">→</span></button></div>
      <p class="form-msg" id="pay-msg" role="status"></p>`,
      "Unpaid",
    )}
  </div>`;
  root.querySelector("#protect").addEventListener("change", (e) => {
    protection = e.target.checked;
    renderCheckout(r);
  });
  root.querySelector("#pay-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const msg = root.querySelector("#pay-msg");
    btn.disabled = true;
    try {
      if (demo) {
        renderPaid(await payDemo(r.id, protection));
      } else {
        location.href = await startCheckout(r.id, protection);
      }
    } catch (err) {
      msg.className = "form-msg bad";
      msg.textContent = err.message;
      btn.disabled = false;
    }
  });
}

async function waitForWebhook(n = 0) {
  const r = await getRequest(id);
  if (r?.payment?.status === "paid") return renderPaid(r);
  if (n > 15) {
    root.innerHTML = `<p class="err">Payment received by Stripe, still waiting for confirmation. Refresh in a minute.</p>`;
    return;
  }
  root.innerHTML = `<p class="loading-hand">confirming your payment…</p>`;
  setTimeout(() => waitForWebhook(n + 1), 2000);
}

(async () => {
  mode = await getMode();
  await loadListings();
  if (!id) {
    root.innerHTML = `<p class="err">No slip picked. Open one from <a href="requests.html">your requests</a>.</p>`;
    return;
  }
  if (params.get("paid") === "1" && mode === "api") return waitForWebhook();
  const r = await getRequest(id).catch(() => null);
  if (!r) {
    root.innerHTML = `<p class="err">We couldn't find slip ${esc(id)} in your requests.</p>`;
    return;
  }
  if (r.payment?.status === "paid") return renderPaid(r);
  if (!canPay(r)) {
    root.innerHTML = `<p class="err">Slip ${esc(r.id)} is ${esc(r.status.replace("_", " "))}. Payment opens once the provider approves it.</p><p><a class="text-link" href="requests.html">back to my requests</a></p>`;
    return;
  }
  renderCheckout(r);
})();
