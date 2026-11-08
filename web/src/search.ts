import { norm } from "./compare";
import type { Data } from "./types";

export interface Suggestion {
  kind: "barcode" | "weighted";
  label: string;
  barcode?: string;
  keyword?: string;
  /** how many of the nearby stores carry it */
  stores: number;
}

interface Index {
  products: { code: string; name: string; n: string; count: number }[];
  weighted: { name: string; n: string; count: number }[];
}

const TWO_WORDS = new Set(["תפוח", "חזה", "פילה", "שמן", "בצל", "פלפל", "כרוב"]);

export function buildIndex(data: Data): Index {
  const products = Object.entries(data.names).map(([code, name]) => ({
    code, name, n: norm(name), count: (data.prices[code] ?? []).filter((p) => p != null).length,
  }));
  const w = new Map<string, { name: string; n: string; count: number }>();
  for (const rows of data.weighted) {
    for (const [name] of rows) {
      const n = norm(name);
      const e = w.get(n);
      if (e) e.count++; else w.set(n, { name, n, count: 1 });
    }
  }
  return { products, weighted: [...w.values()] };
}

function keywordOf(name: string): string {
  const words = norm(name).split(" ");
  return TWO_WORDS.has(words[0]) && words.length > 1 ? words.slice(0, 2).join(" ") : words[0];
}

export function search(index: Index, query: string): Suggestion[] {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hit = (n: string) => tokens.every((t) => n.includes(t));

  const seen = new Set<string>();
  const weighted: Suggestion[] = [];
  for (const w of [...index.weighted].filter((x) => hit(x.n)).sort((a, b) => b.count - a.count)) {
    const kw = keywordOf(w.name);
    if (seen.has(kw)) continue;
    seen.add(kw);
    weighted.push({ kind: "weighted", label: `${kw} (לפי משקל, הזול מכל חנות)`, keyword: kw, stores: w.count });
    if (weighted.length >= 3) break;
  }
  const products = index.products
    .filter((p) => hit(p.n))
    .sort((a, b) => b.count - a.count || a.name.length - b.name.length)
    .slice(0, 7)
    .map<Suggestion>((p) => ({ kind: "barcode", label: p.name, barcode: p.code, stores: p.count }));
  return [...weighted, ...products];
}
