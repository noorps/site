// "From the wings": reviews section on the home page.
// Featured quotes are real words from real people, added with their OK.
// A card only shows once its quote is filled in.
import { PROVIDERS } from "./inventory.js?v=9";
import { listReviews } from "./store.js?v=9";
import { esc } from "./cards.js?v=9";

export const FEATURED = [
  {
    name: "Alicia",
    role: "My middle school theatre teacher",
    quote: "", // waiting on Alicia's own words
  },
];

const stars = (n) => `<span class="rv-rating" aria-label="${n} out of 5">${"✶".repeat(n)}<span class="rv-off">${"✶".repeat(5 - n)}</span></span>`;

export async function renderReviews(section) {
  const featured = FEATURED.filter((f) => f.quote.trim());
  const reviews = (await listReviews()).slice(0, 6);
  if (!featured.length && !reviews.length) {
    section.hidden = true;
    return;
  }
  const cards = [
    ...featured.map(
      (f) => `<figure class="rv-card rv-featured">
        <blockquote>“${esc(f.quote)}”</blockquote>
        <figcaption><span class="rv-name">${esc(f.name)}</span><span class="rv-role">${esc(f.role)}</span></figcaption>
      </figure>`,
    ),
    ...reviews.map((v) => {
      const p = PROVIDERS[v.providerId];
      return `<figure class="rv-card">
        ${stars(v.stars)}
        <blockquote>“${esc(v.text)}”</blockquote>
        <figcaption><span class="rv-name">${esc(v.name)}</span><span class="rv-role">${esc(v.production)}${p ? ` · rented from ${esc(p.name)}` : ""}</span></figcaption>
      </figure>`;
    }),
  ];
  section.querySelector(".rv-grid").innerHTML = cards.join("");
  section.hidden = false;
}
