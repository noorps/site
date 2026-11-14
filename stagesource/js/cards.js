// Shared rendering for request slips (renter page and provider desk).
import { PROVIDERS } from "./inventory.js?v=12";
import { STATUS, quoteFor, canPay } from "./store.js?v=12";
import { dollars } from "./pricing.js?v=12";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = (n) => `$${Math.round(n).toLocaleString()}`;
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ACTION_LABEL = { approved: "Approve", declined: "Decline", picked_up: "Mark picked up", returned: "Mark returned", cancelled: "Cancel request" };
const BY_LABEL = { production: "production", provider: "provider" };

/**
 * One rental slip.
 * opts.side: "production" | "provider"; opts.moves: allowed next statuses.
 */
export function slipCard(r, { side, moves = [], extra = "" }) {
  const p = PROVIDERS[r.providerId] || { name: r.providerId, hood: "", miles: "" };
  const st = STATUS[r.status] || { label: r.status, hint: "" };
  const who =
    side === "provider"
      ? `<p class="rq-who"><b>${esc(r.production)}</b> · ${esc(r.contactName)} · <a href="mailto:${esc(r.contactEmail)}">${esc(r.contactEmail)}</a></p>`
      : `<p class="rq-who"><b>${esc(p.name)}</b> · ${esc(p.hood)}${p.miles ? ` · ${p.miles} mi` : ""}</p>`;
  const paid = r.payment?.status === "paid";
  const free = quoteFor(r, false).total === 0;
  let money_line = "";
  if (["approved", "picked_up", "returned"].includes(r.status) || paid) {
    if (side === "provider") {
      const payout = quoteFor(r, false).providerPayout;
      money_line = paid ? `<p class="rq-pay paid">Paid · you receive ${dollars(payout)}</p>` : free ? `<p class="rq-pay">Free borrow · nothing to collect</p>` : `<p class="rq-pay">Awaiting payment · you'll receive ${dollars(payout)}</p>`;
    } else {
      money_line = paid
        ? `<p class="rq-pay paid">Paid ${dollars(r.payment.amount)} · <a href="pay.html?id=${encodeURIComponent(r.id)}">receipt</a></p>`
        : free
          ? `<p class="rq-pay">Free borrow · nothing to pay</p>`
          : "";
    }
  }
  const payBtn = side === "production" && canPay(r) && !free ? `<a class="btn btn-sm" href="pay.html?id=${encodeURIComponent(r.id)}">Pay &amp; confirm</a>` : "";
  const actions = moves.length || payBtn
    ? `<div class="rq-actions">${payBtn}${moves
        .map((m) => `<button type="button" class="${m === "declined" || m === "cancelled" ? "req" : "btn btn-sm"}" data-move="${m}" data-id="${esc(r.id)}">${ACTION_LABEL[m]}</button>`)
        .join("")}</div>`
    : "";
  return `<article class="rq-card rq-${r.status}">
    <header class="rq-head">
      <div><p class="rq-id">Slip <b>${esc(r.id)}</b> · ${esc(side === "provider" ? "received" : "sent")} ${fmtWhen(r.createdAt)}</p>${who}</div>
      <span class="rq-stamp" title="${esc(st.hint)}">${esc(st.label)}</span>
    </header>
    <div class="rq-body">
      <ul class="rq-items">${r.items.map((i) => `<li><span>${esc(i.title)}</span><span>${i.rate ? `${money(i.rate)}/wk` : "Free"}</span></li>`).join("")}</ul>
      <dl class="rq-meta">
        <div><dt>Pick up</dt><dd>${fmtDate(r.pickup)}</dd></div>
        <div><dt>Return</dt><dd>${fmtDate(r.return)}</dd></div>
        <div><dt>Weeks</dt><dd>${r.weeks}</dd></div>
        <div><dt>Est. total</dt><dd>${money(r.estTotal)}</dd></div>
      </dl>
      ${r.note ? `<p class="rq-note">“${esc(r.note)}”</p>` : ""}
      <ol class="rq-timeline">${r.history
        .map((h) => `<li><b>${esc(STATUS[h.status]?.label || h.status)}</b> <span>${fmtWhen(h.at)} · by ${BY_LABEL[h.by] || esc(h.by)}</span>${h.note ? `<em> “${esc(h.note)}”</em>` : ""}</li>`)
        .join("")}</ol>
      ${money_line}
      <p class="rq-hint">${esc(st.hint)}</p>
      ${extra}
    </div>
    ${actions}
  </article>`;
}
