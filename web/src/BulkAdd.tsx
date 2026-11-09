import { useEffect, useMemo, useState } from "react";
import { resolveCode, type Index } from "./search";

interface Props {
  index: Index;
  names: Record<string, string>;
  /** adds the products and returns a short confirmation */
  onAdd: (entries: { code: string; qty: number }[]) => string;
  onClose: () => void;
}

interface Row { raw: string; qty: number; code: string | null }

const EXAMPLE = "7290112355812 x4\n7290000041445 2\n3029792\n7290016334579 x3";

/** One product per line: a barcode (or the short code printed on receipts), then optionally a quantity. */
export function parseLines(text: string, index: Index): Row[] {
  const rows = new Map<string, Row>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\d{4,13}/);
    if (!m) continue;
    const rest = line.slice((m.index ?? 0) + m[0].length);
    // "x4", "4x", "× 4", "כמות 4", or a lone number at the end of the line. A digit before "." is part of a price or weight.
    const q = rest.match(/[x×*]\s*(\d{1,3})(?![\d.])|(?:^|[^\d.])(\d{1,3})\s*[x×*]|(?:כמות|יח'?|יחידות)\s*:?\s*(\d{1,3})|(?:^|[\s,;])(\d{1,3})\s*$/i);
    // a quantity written before the code: "4 x 7290..." or "x4 7290..."
    const b = line.slice(0, m.index ?? 0).match(/(?:^|[^\d.])(\d{1,3})\s*[x×*]\s*$|[x×*]\s*(\d{1,3})\s*$/i);
    const qty = Math.max(1, b ? Number(b[1] ?? b[2]) : q ? Number(q[1] ?? q[2] ?? q[3] ?? q[4]) : 1);
    const code = resolveCode(index, m[0]);
    const key = code ?? `?${m[0]}`;
    const prev = rows.get(key);
    rows.set(key, prev ? { ...prev, qty: prev.qty + qty } : { raw: m[0], qty, code });
  }
  return [...rows.values()];
}

export default function BulkAdd({ index, names, onAdd, onClose }: Props) {
  const [text, setText] = useState("");
  const [done, setDone] = useState("");
  const rows = useMemo(() => parseLines(text, index), [text, index]);
  const found = rows.filter((r) => r.code);
  const missing = rows.filter((r) => !r.code);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label="הדבקת כמה ברקודים">
      <header className="ph">
        <h2>הדבקת כמה ברקודים</h2>
        <button className="x" onClick={onClose} aria-label="סגירה">×</button>
      </header>
      <div className="pl">
        <p className="muted">שורה לכל מוצר: ברקוד, ואחריו כמות אם צריך (למשל <bdi dir="ltr">7290112355812 x4</bdi>). אפשר להדביק גם שורות מקבלה.
          הקודים הקצרים של הקבלה (למשל <bdi dir="ltr">3029792</bdi>) מזוהים גם הם.</p>
        <label className="sr" htmlFor="bulk">ברקודים</label>
        <textarea id="bulk" value={text} onChange={(e) => { setText(e.target.value); setDone(""); }} rows={6} dir="ltr"
          placeholder={EXAMPLE} spellCheck={false} autoCorrect="off" autoCapitalize="none" />
        {rows.length > 0 && (
          <>
            <h3 className="ph3">{found.length} מוצרים זוהו{missing.length ? `, ${missing.length} לא` : ""}</h3>
            <ul className="cards">
              {found.map((r) => (
                <li key={r.code!} className="card">
                  <div className="ct"><b>{names[r.code!]}</b><small dir="ltr">{r.code}</small></div>
                  <span className="qty">× {r.qty}</span>
                </li>
              ))}
              {missing.map((r) => (
                <li key={r.raw} className="card miss">
                  <div className="ct"><b dir="ltr">{r.raw}</b><small>לא נמצא בקטלוג של החנויות באזור</small></div>
                  <span className="qty">× {r.qty}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted center" role="status" aria-live="polite">{done}</p>
      </div>
      <footer className="pf">
        <button className="done" disabled={!found.length}
          onClick={() => { setDone(onAdd(found.map((r) => ({ code: r.code!, qty: r.qty })))); setText(""); }}>
          {found.length ? `הוספת ${found.length} מוצרים לרשימה` : "הדביקו ברקודים"}
        </button>
      </footer>
    </div>
  );
}
