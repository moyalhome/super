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
  lines: Priced[];
  total: number;
  found: number;
  coverage: number;
  fairTotal: number;
}

export interface Comparison {
  items: Item[];
  unpriced: Item[];
  results: StoreResult[];
  visible: number[];
  fairItems: Item[];
  winner: StoreResult | null;
  winnerFull: boolean;
  split: { store: Store; items: { item: Item; price: number }[]; total: number }[];
  splitTotal: number;
  skippedItems: Item[];
}

/** Default view hides stores that carry less than this share of the list, so one thin store cannot shrink the fair set. */
export const DEFAULT_COVERAGE = 0.7;

/** overrides: store index -> true (force show) / false (force hide); otherwise shown when coverage is high enough */
export function compare(data: Data, all: Item[], overrides: Map<number, boolean>): Comparison {
  const active = all.filter((i) => !i.checked);
  const items = active.filter((i) => i.kind !== "free");
  const unpriced = active.filter((i) => i.kind === "free");

  const results: StoreResult[] = data.stores.map((store, index) => {
    const lines = items.map((it) => priceItem(data, index, it));
    const found = lines.filter((l) => l.price != null).length;
    const total = lines.reduce((s, l) => s + (l.price ?? 0), 0);
    return { store, index, lines, total, found, coverage: items.length ? found / items.length : 0, fairTotal: 0 };
  });

  const auto = results.filter((r) => r.coverage >= DEFAULT_COVERAGE).map((r) => r.index);
  const base = auto.length ? auto : results.map((r) => r.index);
  const visible = results.map((r) => r.index).filter((i) => (overrides.has(i) ? overrides.get(i) : base.includes(i)));

  // fair comparison: only items that every visible store carries
  const fairIdx = items.map((_, k) => k).filter((k) => visible.every((si) => results[si].lines[k].price != null));
  const fairItems = fairIdx.map((k) => items[k]);
  for (const r of results) r.fairTotal = fairIdx.reduce((s, k) => s + (r.lines[k].price ?? 0), 0);

  const vis = visible.map((i) => results[i]);
  const full = vis.filter((r) => r.found === items.length && items.length > 0);
  const pool = full.length ? full : vis;
  const winner = pool.length ? [...pool].sort((a, b) => (full.length ? a.total - b.total : a.fairTotal - b.fairTotal))[0] : null;

  // split basket: cheapest visible store per item
  const byStore = new Map<number, { item: Item; price: number }[]>();
  const skippedItems: Item[] = [];
  items.forEach((it, k) => {
    let best: StoreResult | null = null;
    for (const r of vis) {
      const p = r.lines[k].price;
      if (p != null && (!best || p < (best.lines[k].price as number))) best = r;
    }
    if (!best) return void skippedItems.push(it);
    const arr = byStore.get(best.index) ?? [];
    arr.push({ item: it, price: best.lines[k].price as number });
    byStore.set(best.index, arr);
  });
  const split = [...byStore.entries()]
    .map(([si, its]) => ({ store: data.stores[si], items: its, total: its.reduce((s, x) => s + x.price, 0) }))
    .sort((a, b) => b.total - a.total);

  return {
    items, unpriced, results, visible, fairItems, winner, winnerFull: full.length > 0,
    split, splitTotal: split.reduce((s, x) => s + x.total, 0), skippedItems,
  };
}

export const shekel = (agorot: number) => (agorot / 100).toFixed(2).replace(/\.00$/, "") + " ₪";
