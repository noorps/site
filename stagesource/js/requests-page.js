import { myRequests, updateStatus, getMode, RENTER_MOVES, loadListings } from "./store.js?v=7";
import { slipCard } from "./cards.js?v=7";

const list = document.getElementById("rq-list");

async function render() {
  await loadListings();
  if ((await getMode()) === "local") document.getElementById("demo-note").hidden = false;
  let reqs;
  try {
    reqs = await myRequests();
  } catch {
    list.innerHTML = `<p class="err">Couldn't load your requests. Refresh to try again.</p>`;
    return;
  }
  if (!reqs.length) {
    list.innerHTML = `<div class="rq-empty"><p class="empty-title">No slips yet</p><p class="empty-hand">hold a few props and send a request ↓</p><a class="btn" href="./#inventory">Browse inventory <span aria-hidden="true">→</span></a></div>`;
    return;
  }
  const open = reqs.filter((r) => ["pending", "approved", "picked_up"].includes(r.status));
  const closed = reqs.filter((r) => !open.includes(r));
  const section = (title, rs) =>
    rs.length ? `<p class="pl-cat">${title}<span>${rs.length}</span></p><div class="rq-grid">${rs.map((r) => slipCard(r, { side: "production", moves: RENTER_MOVES[r.status] || [] })).join("")}</div>` : "";
  list.innerHTML = section("Open", open) + section("Closed", closed);
}

list.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-move]");
  if (!b) return;
  if (b.dataset.move === "cancelled" && !confirm("Cancel this request? The provider will see it as cancelled.")) return;
  b.disabled = true;
  try {
    await updateStatus(b.dataset.id, b.dataset.move, "production");
  } catch (err) {
    alert(err.message);
  }
  render();
});

render();
// Pick up changes made in the provider desk in another tab.
window.addEventListener("focus", render);
