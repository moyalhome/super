import type { Data, Item, Store } from "./types";

export const norm = (s: string) => s.replace(/["'׳״`]/g, "").replace(/\s+/g, " ").trim();

/** Words that mean "not the plain fresh product". Skipped when the keyword itself contains the word. */
const DEFAULT_EXCLUDE = [
  "שימור", "חמוץ", "במלח", "בחומץ", "ציפס", "צפס", "מיובש", "קפוא", "טחון", "מוכן", "מרוסק",
  "רסק", "רוטב", "סלט", "חטיף", "מטוגן", "מעושן", "מתובל",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "בננה" must also match "בננות": loosen the last word's ending. */
function keywordRegex(keyword: string): RegExp {
  const words = norm(keyword).split(" ").filter(Boolean);
  if (!words.length) return /$^/;
  const last = words[words.length - 1];
  const loose = last.endsWith("ה") ? escapeRe(last.slice(0, -1)) + "(ה|ות)" : escapeRe(last) + "(ים|ות)?";
  const head = words.slice(0, -1).map(escapeRe);
  return new RegExp("(^|\\s)" + [...head, loose].join("\\s+"));
}

export function matchWeighted(rows: [string, number][], keyword: string, exclude = ""): [string, number] | null {
  const re = keywordRegex(keyword);
  const kw = norm(keyword);
  const ex = [
    ...DEFAULT_EXCLUDE.filter((t) => !kw.includes(t)),
    ...exclude.split(/[,;\n]+/).map(norm).filter(Boolean),
  ];
  let best: [string, number] | null = null;
  for (const r of rows) {
    const n = norm(r[0]);
    if (!re.test(n) || ex.some((t) => n.includes(t))) continue;
    if (!best || r[1] < best[1]) best = r;
  }
  return best;
}

export interface Priced {
  /** agorot for the requested quantity, null when this store does not carry it */
  price: number | null;
  /** product that was matched (shown so a wrong match can be spotted) */
  label?: string;
  unit?: number;
}

export function priceItem(data: Data, storeIndex: number, item: Item): Priced {
  if (item.kind === "barcode" && item.barcode) {
    const c = data.prices[item.barcode]?.[storeIndex];
    return c == null ? { price: null } : { price: Math.round(c * item.qty), unit: c };
  }
  if (item.kind === "weighted" && item.keyword) {
    const m = matchWeighted(data.weighted[storeIndex] ?? [], item.keyword, item.exclude);
    return m ? { price: Math.round(m[1] * item.qty), label: m[0], unit: m[1] } : { price: null };
  }
  return { price: null };
}

export interface StoreResult {
  store: Store;
  index: number;
  /** one entry per required item, same order as Comparison.items */
  lines: Priced[];
  /** sum of the items this store carries */
  total: number;
  found: number;
  missing: Item[];
}

export interface SplitPlan {
  stores: { store: Store; items: { item: Item; price: number }[]; total: number }[];
  total: number;
  uncovered: Item[];
}

export interface Comparison {
  /** items on the list that at least one store carries */
  items: Item[];
  /** priced items that no nearby store carries */
  notFound: Item[];
  /** free-text items (no price) */
  unpriced: Item[];
  results: StoreResult[];
  /** stores that carry every item, cheapest first */
  full: StoreResult[];
  /** stores missing something, most complete first */
  partial: StoreResult[];
  winner: StoreResult | null;
  split: SplitPlan;
}

/** maxStores = 0 means no limit. */
function planSplit(results: StoreResult[], items: Item[], maxStores: number): SplitPlan {
  const n = results.length;
  const cheapest = (combo: number[], k: number) => {
    let best: { si: number; price: number } | null = null;
    for (const si of combo) {
      const p = results[si].lines[k].price;
      if (p != null && (!best || p < best.price)) best = { si, price: p };
    }
    return best;
  };
  const evaluate = (combo: number[]) => {
    let covered = 0, total = 0;
    items.forEach((_, k) => { const b = cheapest(combo, k); if (b) { covered++; total += b.price; } });
    return { covered, total };
  };

  let bestCombo: number[] = [];
  if (!maxStores || maxStores >= n) {
    bestCombo = results.map((r) => r.index);
  } else {
    let best = { covered: -1, total: Infinity };
    const walk = (start: number, combo: number[]) => {
      if (combo.length) {
        const e = evaluate(combo);
        if (e.covered > best.covered || (e.covered === best.covered && e.total < best.total)) { best = e; bestCombo = [...combo]; }
      }
      if (combo.length === maxStores) return;
      for (let i = start; i < n; i++) walk(i + 1, [...combo, i]);
    };
    walk(0, []);
  }

  const byStore = new Map<number, { item: Item; price: number }[]>();
  const uncovered: Item[] = [];
  items.forEach((it, k) => {
    const b = cheapest(bestCombo, k);
    if (!b) { uncovered.push(it); return; }
    const arr = byStore.get(b.si) ?? [];
    arr.push({ item: it, price: b.price });
    byStore.set(b.si, arr);
  });
  const stores = [...byStore.entries()]
    .map(([si, its]) => ({ store: results[si].store, items: its, total: its.reduce((s, x) => s + x.price, 0) }))
    .sort((a, b) => b.total - a.total);
  return { stores, total: stores.reduce((s, x) => s + x.total, 0), uncovered };
}

export function compare(data: Data, all: Item[], splitMax: number): Comparison {
  const active = all.filter((i) => !i.checked);
  const priced = active.filter((i) => i.kind !== "free");
  const unpriced = active.filter((i) => i.kind === "free");

  const lines = data.stores.map((_, si) => priced.map((it) => priceItem(data, si, it)));
  const carried = priced.map((_, k) => lines.some((l) => l[k].price != null));
  const idx = priced.map((_, k) => k).filter((k) => carried[k]);
  const items = idx.map((k) => priced[k]);
  const notFound = priced.filter((_, k) => !carried[k]);

  const results: StoreResult[] = data.stores.map((store, si) => {
    const ls = idx.map((k) => lines[si][k]);
    return {
      store, index: si, lines: ls,
      total: ls.reduce((s, l) => s + (l.price ?? 0), 0),
      found: ls.filter((l) => l.price != null).length,
      missing: items.filter((_, j) => ls[j].price == null),
    };
  });

  const full = results.filter((r) => items.length > 0 && r.missing.length === 0).sort((a, b) => a.total - b.total);
  const partial = results.filter((r) => r.missing.length > 0).sort((a, b) => b.found - a.found || a.total - b.total);
  return {
    items, notFound, unpriced, results, full, partial,
    winner: full[0] ?? partial[0] ?? null,
    split: planSplit(results, items, splitMax),
  };
}

export const shekel = (agorot: number) => (agorot / 100).toFixed(2).replace(/\.00$/, "") + " ₪";
