// Pricing for a rental request. Pure functions, shared by the page and the API.
// All amounts are whole cents.

export const SERVICE_FEE = 0.1; // charged to the production, on the rental subtotal
export const PROVIDER_FEE = 0.05; // kept from the provider's payout
export const PROTECTION_RATE = 0.04; // optional damage protection, on items' replacement value
export const PROTECTION_MIN = 200;

/**
 * req: { items: [{ rate, replace? }], weeks }
 * replaceOf: listingId -> replacement value in dollars (falls back to item.replace)
 */
export function quote(req, { protection = false, replaceOf = () => 0 } = {}) {
  const subtotal = req.items.reduce((s, i) => s + Math.round(i.rate * 100) * req.weeks, 0);
  const serviceFee = Math.round(subtotal * SERVICE_FEE);
  const replaceValue = req.items.reduce((s, i) => s + Math.round((i.replace ?? replaceOf(i.listingId) ?? 0) * 100), 0);
  const protectionFee = protection ? Math.max(PROTECTION_MIN, Math.round(replaceValue * PROTECTION_RATE)) : 0;
  const total = subtotal + serviceFee + protectionFee;
  const providerPayout = subtotal - Math.round(subtotal * PROVIDER_FEE);
  return { subtotal, serviceFee, protectionFee, replaceValue, total, providerPayout, platformTake: total - providerPayout };
}

export const dollars = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
