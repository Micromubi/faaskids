// FaasKids pricing engine — shared by the browser (cart preview) and the server
// (checkout). The server always re-prices from the live catalog, so the cart a
// customer sees and the total they're charged come from the same code.

export const fmt = n => '₦' + Math.round(Number(n || 0)).toLocaleString('en-NG');

/** 0809… / +234809… / 234809… → 234809… */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = '234' + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
  return d;
}

export const productStock = p => (p.variants || []).reduce((s, v) => s + Math.max(0, v.stock || 0), 0);
export const isOnSale = p => p.compareAt > p.price;
export const salePercent = p => isOnSale(p) ? Math.round((1 - p.price / p.compareAt) * 100) : 0;

function bundleSetValue(bundle, byId) {
  const sum = bundle.items.reduce((s, id) => s + (byId.get(id)?.price || 0), 0);
  const saving = bundle.type === 'fixed'
    ? Math.min(sum, bundle.value || 0)
    : Math.round(sum * Math.min(90, Math.max(0, bundle.value || 0)) / 100);
  return { sum, saving };
}

export function activeBundles(catalog) {
  const byId = new Map((catalog.products || []).map(p => [p.id, p]));
  return (catalog.bundles || []).filter(b =>
    b.active !== false &&
    b.items?.length >= 2 &&
    b.items.every(id => byId.get(id)?.active !== false && byId.has(id)));
}

/** Combo deal value for display on product pages: { sum, saving, price } */
export function bundleOffer(catalog, bundle) {
  const byId = new Map(catalog.products.map(p => [p.id, p]));
  const { sum, saving } = bundleSetValue(bundle, byId);
  return { sum, saving, price: sum - saving };
}

/**
 * lines: [{ productId, variantId, qty }]
 * opts:  { promoCode, zoneId, promos } — promos only exist server-side; the
 *        browser passes the promo it got back from /api/catalog?promo=CODE.
 */
export function priceCart(catalog, lines, opts = {}) {
  const byId = new Map((catalog.products || []).map(p => [p.id, p]));
  const settings = catalog.settings || {};
  const errors = [];

  const priced = [];
  for (const l of lines || []) {
    const p = byId.get(l.productId);
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    if (!p || p.active === false || !qty) continue;
    const v = (p.variants || []).find(x => x.id === l.variantId) || (p.variants || [])[0];
    if (!v) continue;
    const stock = Math.max(0, v.stock || 0);
    let error = null;
    if (stock <= 0) error = 'Sold out';
    else if (qty > stock) error = `Only ${stock} left`;
    if (error) errors.push(`${p.name}${v.label ? ' (' + v.label + ')' : ''}: ${error}`);
    priced.push({
      productId: p.id,
      variantId: v.id,
      name: p.name,
      variantLabel: v.label || '',
      image: (p.images || [])[0] || '',
      unitPrice: p.price,
      compareAt: p.compareAt || 0,
      qty,
      stock,
      amount: p.price * qty,
      error
    });
  }
  const subtotal = priced.reduce((s, l) => s + l.amount, 0);

  // ---- combo deals: greedy, biggest saving per set first ----
  const remaining = new Map();
  priced.forEach(l => remaining.set(l.productId, (remaining.get(l.productId) || 0) + l.qty));
  const bundles = activeBundles(catalog)
    .map(b => ({ b, ...bundleSetValue(b, byId) }))
    .sort((x, y) => y.saving - x.saving);
  const applied = [];
  for (const { b, saving } of bundles) {
    const sets = Math.min(...b.items.map(id => remaining.get(id) || 0));
    if (sets > 0 && saving > 0) {
      b.items.forEach(id => remaining.set(id, remaining.get(id) - sets));
      applied.push({ id: b.id, name: b.name, sets, saving: saving * sets });
    }
  }
  const bundleSaving = applied.reduce((s, a) => s + a.saving, 0);

  // ---- "complete the combo" nudges from what's left over ----
  const hints = [];
  for (const { b, saving } of bundles) {
    const have = b.items.filter(id => (remaining.get(id) || 0) > 0);
    const missing = b.items.filter(id => !(remaining.get(id) > 0));
    if (have.length && missing.length && missing.length <= 2 && saving > 0) {
      hints.push({
        id: b.id, name: b.name, saving,
        missing: missing.map(id => ({ id, name: byId.get(id).name, price: byId.get(id).price }))
      });
    }
  }

  // ---- promo code, or the automatic website discount ----
  // Codes don't stack: a valid code replaces the automatic discount if it's bigger.
  const base = subtotal - bundleSaving;
  const promos = opts.promos || [];
  const phone = opts.phone ? normalizePhone(opts.phone) : '';
  const check = pr => {
    if (pr.expires && Date.now() > new Date(pr.expires).getTime() + 864e5) return 'That code has expired';
    if (pr.maxUses && (pr.used || 0) >= pr.maxUses) return 'That code has already been used up';
    if (pr.onePerCustomer && phone && (pr.usedBy || []).includes(phone)) return 'You’ve already used this code';
    if (pr.minSubtotal && base < pr.minSubtotal) return `Spend ${fmt(pr.minSubtotal)} to use ${pr.auto ? 'the website discount' : pr.code}`;
    return null;
  };
  const value = pr => pr.type === 'fixed' ? Math.min(base, pr.value || 0)
    : pr.type === 'freeship' ? 0
    : Math.round(base * Math.min(90, pr.value || 0) / 100);
  const asPromo = pr => ({ code: pr.code, type: pr.type, value: pr.value, saving: value(pr), auto: Boolean(pr.auto), label: pr.label || '' });

  let promo = null, promoError = null;
  const autos = promos.filter(x => x.auto && x.active !== false && !check(x)).map(asPromo).sort((x, y) => y.saving - x.saving);
  const code = String(opts.promoCode || '').trim().toUpperCase();
  if (code) {
    const pr = promos.find(x => x.code.toUpperCase() === code && x.active !== false && !x.auto);
    if (!pr) promoError = 'That code isn’t valid';
    else if ((promoError = check(pr))) { /* error set */ }
    else promo = asPromo(pr);
  }
  if (autos[0] && (!promo || (autos[0].saving > promo.saving && promo.type !== 'freeship'))) {
    if (promo) promoError = `${promo.code} isn’t needed — your website discount is bigger`;
    promo = autos[0];
  }
  const promoSaving = promo?.saving || 0;
  const merchandise = Math.max(0, subtotal - bundleSaving - promoSaving);

  // ---- delivery ----
  const zones = settings.zones || [];
  const zone = zones.find(z => z.id === opts.zoneId) || null;
  const threshold = settings.freeDeliveryOver || 0;
  const freeByThreshold = threshold > 0 && merchandise >= threshold;
  const freeByPromo = promo?.type === 'freeship';
  const deliveryFee = zone && !(freeByThreshold || freeByPromo) ? (zone.fee || 0) : 0;
  const freeDeliveryGap = threshold > 0 && !freeByThreshold && merchandise > 0 ? threshold - merchandise : 0;

  return {
    lines: priced,
    subtotal,
    bundles: applied,
    leftover: Object.fromEntries(remaining),
    bundleSaving,
    hints,
    promo,
    promoError,
    zone: zone && { id: zone.id, name: zone.name, fee: zone.fee || 0 },
    deliveryFee,
    freeDelivery: Boolean(zone && zone.fee && (freeByThreshold || freeByPromo)),
    freeDeliveryGap,
    totalSaving: bundleSaving + promoSaving,
    itemCount: priced.reduce((s, l) => s + l.qty, 0),
    total: merchandise + deliveryFee,
    errors
  };
}

/**
 * "Frequently bought together": real co-purchase counts first (catalog.pairs is
 * updated with every order), then combo partners, then same-age complementary
 * picks from other categories.
 */
export function recommend(catalog, productId, n = 4, exclude = []) {
  const products = (catalog.products || []).filter(p => p.active !== false && productStock(p) > 0);
  const byId = new Map(products.map(p => [p.id, p]));
  const skip = new Set([productId, ...exclude]);
  const score = new Map();
  const bump = (id, s) => { if (!skip.has(id) && byId.has(id)) score.set(id, (score.get(id) || 0) + s); };

  for (const [key, count] of Object.entries(catalog.pairs || {})) {
    const [a, b] = key.split('|');
    if (a === productId) bump(b, count * 10);
    if (b === productId) bump(a, count * 10);
  }
  for (const b of catalog.bundles || []) {
    if (b.active !== false && b.items?.includes(productId)) b.items.forEach(id => bump(id, 6));
  }
  const me = (catalog.products || []).find(p => p.id === productId);
  if (me) {
    products.forEach(p => {
      if (p.category !== me.category) bump(p.id, 1 + (p.featured ? 1 : 0));
      else bump(p.id, 0.5);
    });
  }
  return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([id]) => byId.get(id));
}

/**
 * Which products of a combo still need adding to the bag to complete one more set.
 * Items already in the bag that aren't yet part of a combo discount count towards
 * it, so adding "the combo" never doubles the item the shopper already chose.
 */
export function comboMissing(catalog, lines, bundle) {
  const q = priceCart(catalog, lines);
  return bundle.items.filter(id => !((q.leftover[id] || 0) > 0));
}
