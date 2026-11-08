import { useEffect, useMemo, useRef, useState } from "react";
import { norm, shekel } from "./compare";
import { OTHER, classify } from "./departments";
import { DEPT_EMOJI, ProductImg } from "./images";
import { search as searchIndex, type Index } from "./search";
import type { Data, HistoryEntry, Item } from "./types";

interface Props {
  data: Data;
  index: Index;
  items: Item[];
  order: string[];
  kv: Record<string, unknown>;
  history: HistoryEntry[];
  initialQuery: string;
  /** each returns a short confirmation to show at the bottom */
  onAddCode: (code: string) => string;
  onAddWeighted: (keyword: string) => string;
  onAddHistory: (h: HistoryEntry) => string;
  onClose: () => void;
}

type Sort = "popular" | "price" | "name";
const PAGE = 40;

// classifying all ~25,000 product names once is cheap enough, and it is shared by every picker session
const baseDepts = new WeakMap<Index, Map<string, string>>();
function baseDeptMap(index: Index): Map<string, string> {
  let m = baseDepts.get(index);
  if (!m) { m = new Map(index.products.map((p) => [p.code, classify(p.name, false)])); baseDepts.set(index, m); }
  return m;
}

export default function Picker({ data, index, items, order, kv, history, initialQuery, onAddCode, onAddWeighted, onAddHistory, onClose }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [dept, setDept] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("popular");
  const [limit, setLimit] = useState(PAGE);
  const [toast, setToast] = useState("");
  const timer = useRef<number>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { setLimit(PAGE); }, [q, dept, brand, sort]);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 3000);
  };

  const base = useMemo(() => baseDeptMap(index), [index]);
  const deptOfCode = (code: string) => {
    const remembered = kv[`dept:b:${code}`];
    return typeof remembered === "string" && remembered ? remembered : base.get(code) ?? OTHER;
  };

  const tokens = useMemo(() => norm(q).split(" ").filter(Boolean), [q]);
  const browsing = tokens.length > 0 || dept !== null;

  const { shown, total, brands } = useMemo(() => {
    if (!browsing) return { shown: [], total: 0, brands: [] as [string, number][] };
    let list = index.products;
    if (tokens.length) list = list.filter((p) => tokens.every((t) => p.n.includes(t)));
    if (dept) list = list.filter((p) => deptOfCode(p.code) === dept);
    const counts = new Map<string, number>();
    for (const p of list) { const b = data.brands[p.code]; if (b) counts.set(b, (counts.get(b) ?? 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (brand) list = list.filter((p) => data.brands[p.code] === brand);
    const minPrice = (code: string) => Math.min(...(data.prices[code] ?? []).filter((x): x is number => x != null));
    const sorted = [...list].sort(
      sort === "price" ? (a, b) => minPrice(a.code) - minPrice(b.code)
      : sort === "name" ? (a, b) => a.name.localeCompare(b.name, "he")
      : (a, b) => b.count - a.count || a.name.length - b.name.length,
    );
    return { shown: sorted.slice(0, limit), total: sorted.length, brands: top };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tokens, dept, brand, sort, limit, data, kv, browsing]);

  const weighted = useMemo(() => (tokens.length && !dept && !brand ? searchIndex(index, q).filter((s) => s.kind === "weighted" && tokens.every((t) => norm(s.keyword ?? "").includes(t))) : []), [index, q, tokens, dept, brand]);

  const onList = (code: string) => items.some((i) => i.kind === "barcode" && i.barcode === code && !i.checked);
  const histOnList = (h: HistoryEntry) =>
    items.some((i) => i.kind === h.kind && (h.kind === "barcode" ? i.barcode === h.barcode : h.kind === "weighted" ? i.keyword === h.keyword : i.text === h.text));
  const past = history.filter((h) => !histOnList(h)).slice(0, 12);

  const range = (code: string) => {
    const ps = (data.prices[code] ?? []).filter((x): x is number => x != null);
    if (!ps.length) return "";
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const n = (a: number) => (a / 100).toFixed(2).replace(/\.00$/, "");
    return lo === hi ? shekel(lo) : `${n(lo)}–${n(hi)} ₪`;
  };

  const depts = [...order, OTHER];
  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label="עיון במוצרים">
      <header className="ph">
        <h2>עיון במוצרים</h2>
        <button className="x" onClick={onClose} aria-label="סגירה">×</button>
      </header>
      <div className="pc">
        <label className="sr" htmlFor="pq">חיפוש מוצר</label>
        <input id="pq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש: חלב, שוקולד, אסם…" autoFocus autoComplete="off" />
        <div className="hs" role="group" aria-label="סינון לפי מחלקה">
          {depts.map((d) => (
            <button key={d} aria-pressed={dept === d} className={dept === d ? "on" : ""} onClick={() => setDept(dept === d ? null : d)}>
              <span aria-hidden="true">{DEPT_EMOJI[d] ?? "🛒"}</span> {d}
            </button>
          ))}
        </div>
        {brands.length > 0 && (
          <div className="hs" role="group" aria-label="סינון לפי יצרן">
            {brands.map(([b, n]) => (
              <button key={b} aria-pressed={brand === b} className={brand === b ? "on" : ""} onClick={() => setBrand(brand === b ? null : b)}>{b} ({n})</button>
            ))}
          </div>
        )}
        {browsing && (
          <div className="sortrow">
            <span>{total} מוצרים</span>
            <label>
              <span className="sr">מיון</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="popular">הנפוצים ביותר</option>
                <option value="price">המחיר הנמוך ביותר</option>
                <option value="name">לפי שם</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="pl">
        {!browsing && (
          <>
            {past.length > 0 && (
              <>
                <h3 className="ph3">קניתם בעבר</h3>
                <ul className="cards">
                  {past.map((h) => (
                    <li key={h.key} className="card">
                      <ProductImg code={h.kind === "barcode" ? h.barcode ?? undefined : undefined} dept={h.dept ?? OTHER} name={h.text} size={56} />
                      <div className="ct"><b>{h.text}</b><small>נקנה {h.times} פעמים</small></div>
                      <button onClick={() => flash(onAddHistory(h))}>הוספה</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted center">הקלידו שם מוצר או יצרן, או בחרו מחלקה כדי לראות את כל האפשרויות.</p>
          </>
        )}

        {weighted.length > 0 && (
          <ul className="cards">
            {weighted.map((w) => (
              <li key={w.keyword} className="card">
                <ProductImg dept={classify(w.keyword!, true)} name={w.keyword!} size={56} />
                <div className="ct"><b>{w.keyword}</b><small>לפי משקל · הזול מכל חנות · {w.stores} חנויות</small></div>
                <button onClick={() => flash(onAddWeighted(w.keyword!))}>הוספה</button>
              </li>
            ))}
          </ul>
        )}

        {browsing && (
          <ul className="cards">
            {shown.map((p) => {
              const d = deptOfCode(p.code);
              const on = onList(p.code);
              return (
                <li key={p.code} className="card">
                  <ProductImg code={p.code} dept={d} name={p.name} size={56} />
                  <div className="ct">
                    <b>{p.name}</b>
                    <small>{[data.brands[p.code], `${p.count} חנויות`].filter(Boolean).join(" · ")}</small>
                    <span className="pr">{range(p.code)}</span>
                  </div>
                  <button className={on ? "again" : ""} onClick={() => flash(onAddCode(p.code))} aria-label={`${on ? "עוד אחד" : "הוספה"}: ${p.name}`}>
                    {on ? "✓ עוד אחד" : "הוספה"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {browsing && total > shown.length && <button className="wide" onClick={() => setLimit(limit + PAGE)}>הצגת עוד ({total - shown.length})</button>}
        {browsing && total === 0 && weighted.length === 0 && <p className="muted center">לא נמצאו מוצרים. נסו מילה אחרת או הסירו סינון.</p>}
        <p className="foot">תמונות, כשקיימות: Open Food Facts (CC BY-SA). המחירים הם טווח בין החנויות באזור.</p>
      </div>

      <div className="ptoast" role="status" aria-live="polite">{toast}</div>
      <footer className="pf"><button className="done" onClick={onClose}>סיום</button></footer>
    </div>
  );
}

