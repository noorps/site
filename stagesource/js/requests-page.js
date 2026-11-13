import { myRequests, updateStatus, getMode, RENTER_MOVES, loadListings, addReview, reviewedIds } from "./store.js?v=10";
import { slipCard, esc } from "./cards.js?v=10";

const list = document.getElementById("rq-list");

const reviewForm = (r) => `
  <form class="rv-form" data-review="${esc(r.id)}">
    <p class="rv-q">How was it?</p>
    <div class="rv-stars" role="radiogroup" aria-label="Rating">
      ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="stars" value="${n}" ${n === 5 ? "checked" : ""}><span aria-hidden="true">✶</span><b class="sr">${n} star${n === 1 ? "" : "s"}</b></label>`).join("")}
    </div>
    <label class="line">Your review<textarea name="text" rows="2" placeholder="The chaise was perfect and pickup took five minutes…"></textarea></label>
    <button class="btn btn-sm" type="submit">Post review</button>
    <p class="form-msg" role="status"></p>
  </form>`;

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
  const done = await reviewedIds();
  const open = reqs.filter((r) => ["pending", "approved", "picked_up"].includes(r.status));
  const closed = reqs.filter((r) => !open.includes(r));
  const card = (r) =>
    slipCard(r, {
      side: "production",
      moves: RENTER_MOVES[r.status] || [],
      extra: r.status === "returned" ? (done.has(r.id) ? `<p class="rq-pay paid">Reviewed. Thank you!</p>` : reviewForm(r)) : "",
    });
  const section = (title, rs) => (rs.length ? `<p class="pl-cat">${title}<span>${rs.length}</span></p><div class="rq-grid">${rs.map(card).join("")}</div>` : "");
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

list.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-review]");
  if (!f) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  const msg = f.querySelector(".form-msg");
  try {
    await addReview(f.dataset.review, data);
    render();
  } catch (err) {
    msg.className = "form-msg bad";
    msg.textContent = err.message;
  }
});

render();
// Pick up changes made in the provider desk in another tab (but don't wipe a review being typed).
window.addEventListener("focus", () => {
  if (!list.querySelector(".rv-form textarea:focus") && !list.querySelector(".rv-form textarea")?.value) render();
});
