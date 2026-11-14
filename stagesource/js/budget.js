// Show budget + donor report, on My requests.
// Added after an interview with a producer at an Austin theater: shows there run on ticket
// sales plus community donations, and every dollar spent on materials is a dollar not paid
// to actors. So: track rental spend against the budget, and give producers a one-page
// savings report to hand back to the donors who funded the show.
import { listingById } from "./store.js?v=11";
import { PROVIDERS } from "./inventory.js?v=11";
import { esc, money } from "./cards.js?v=11";

const KEY = "stagesource:budget";
const live = (r) => !["declined", "cancelled"].includes(r.status);

function loadBudget() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function saveBudget(b) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* private mode */
  }
}

/** Dollars. Paid requests count what was paid; the rest count the estimate. */
export function budgetSummary(reqs, total) {
  const rs = reqs.filter(live);
  const rentals = rs.reduce((s, r) => s + (r.payment?.status === "paid" ? r.payment.amount / 100 : r.estTotal), 0);
  const items = rs.flatMap((r) => r.items);
  const buyNew = items.reduce((s, i) => s + (listingById(i.listingId)?.replace || 0), 0);
  const lenders = new Set(rs.map((r) => r.providerId)).size;
  const t = Number(total) || 0;
  return { rentals, buyNew, saved: Math.max(0, buyNew - rentals), items: items.length, lenders, total: t, left: t ? t - rentals : null, reused: items.length };
}

export function mountBudget(getReqs) {
  const show = document.getElementById("bud-show");
  const total = document.getElementById("bud-total");
  const stats = document.getElementById("budget-stats");
  const report = document.getElementById("donor-report");
  const b = loadBudget();
  show.value = b.show || "";
  total.value = b.total || "";

  async function paint() {
    const reqs = await getReqs();
    const s = budgetSummary(reqs, total.value);
    stats.innerHTML = `
      <div><b>${money(s.rentals)}</b><span>on rentals</span></div>
      <div><b>${money(s.buyNew)}</b><span>to buy it all new</span></div>
      <div><b class="hot">${money(s.saved)}</b><span>saved</span></div>
      <div><b class="blue">${s.left == null ? "—" : money(s.left)}</b><span>${s.left == null ? "add a budget" : "left for cast & crew"}</span></div>`;
    return { reqs, s };
  }

  const persist = () => {
    saveBudget({ show: show.value.trim(), total: total.value });
    paint();
  };
  show.addEventListener("input", persist);
  total.addEventListener("input", persist);

  document.getElementById("donor-btn").addEventListener("click", async () => {
    const { reqs, s } = await paint();
    const rs = reqs.filter(live);
    const name = show.value.trim() || rs[0]?.production || "Our production";
    const lenders = [...new Set(rs.map((r) => PROVIDERS[r.providerId]?.name).filter(Boolean))];
    report.innerHTML = `
      <p class="dr-kicker">A note to our supporters</p>
      <h1 class="dr-title">${esc(name)}</h1>
      <p class="dr-lede">Your donations put this show on stage. By borrowing from theaters across Austin instead of buying new, we kept more of that money for the people in it.</p>
      <div class="dr-stats">
        <div><b>${s.items}</b><span>props, costumes &amp; pieces borrowed</span></div>
        <div><b>${money(s.saved)}</b><span>saved vs. buying new</span></div>
        ${s.left == null ? "" : `<div><b>${money(s.left)}</b><span>of our ${money(s.total)} budget left for cast &amp; crew</span></div>`}
      </div>
      ${lenders.length ? `<p class="dr-thanks">Thank you to ${lenders.map(esc).join(", ").replace(/, ([^,]*)$/, " and $1")} for lending, and keeping ${s.items} pieces out of a landfill.</p>` : ""}
      <p class="dr-foot">Sourced with StageSource · Austin, TX</p>`;
    window.print();
  });

  return paint;
}
