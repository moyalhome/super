import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadCode, Locked, canon, clearCode, loadData, localBackend, readCode, remoteBackend, remoteConfigured, saveCode,
  type Backend,
} from "./api";
import { compare, shekel, type Comparison } from "./compare";
import { buildIndex, findBarcode, search, type Suggestion } from "./search";
import Scanner, { type ScanResult } from "./Scanner";
import type { Data, Item } from "./types";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });

type Status = "loading" | "ok" | "offline" | "locked";

export default function App() {
  const [code, setCode] = useState<string | null>(() => readCode());
  const backend = useMemo<Backend | null>(
    () => (remoteConfigured ? (code ? remoteBackend(code) : null) : localBackend()),
    [code],
  );
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [lockError, setLockError] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [dataError, setDataError] = useState("");
  const [tab, setTab] = useState<"list" | "compare">("list");
  const pending = useRef(0);

  useEffect(() => {
    loadData().then(setData).catch((e) => setDataError(String(e)));
  }, []);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof BadCode) { clearCode(); setCode(null); setLockError(true); }
    else if (e instanceof Locked) setStatus("locked");
    else setStatus("offline");
  }, []);

  const refresh = useCallback(async () => {
    if (!backend || pending.current > 0) return;
    try {
      const l = await backend.list();
      if (pending.current === 0) setItems(l);
      setStatus("ok");
    } catch (e) { handleError(e); }
  }, [backend, handleError]);

  useEffect(() => {
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const t = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  const mutate = async (apply: (l: Item[]) => Item[], op: () => Promise<void>) => {
    setItems(apply);
    pending.current++;
    try { await op(); setStatus("ok"); } catch (e) { handleError(e); } finally {
      pending.current--;
      if (pending.current === 0) refresh();
    }
  };
  const add = (item: Item) => mutate((l) => [...l, item], () => backend!.upsert(item));
  const update = (item: Item) => mutate((l) => l.map((x) => (x.id === item.id ? item : x)), () => backend!.upsert(item));
  const remove = (id: string) => mutate((l) => l.filter((x) => x.id !== id), () => backend!.remove(id));

  if (!backend) {
    return <Lock error={lockError} onCode={(c) => { const k = canon(c); saveCode(k); setLockError(false); setCode(k); }} />;
  }

  const open = items.filter((i) => !i.checked).length;
  return (
    <div className="app">
      <header>
        <h1>רשימת קניות</h1>
        <span className={`dot ${status}`} title={status === "ok" ? "מחובר" : status === "offline" ? "אין חיבור" : "טוען"} />
      </header>
      {!backend.shared && <p className="banner">מצב מקומי: הרשימה נשמרת רק במכשיר הזה.</p>}
      {status === "locked" && <p className="banner warn">יותר מדי ניסיונות כושלים לקוד, והגישה נעולה זמנית (עד שעה). נסו שוב מאוחר יותר.</p>}
      {status === "offline" && <p className="banner warn">אין חיבור לשרת. השינויים יישמרו כשהחיבור יחזור.</p>}
      <nav>
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>רשימה ({open})</button>
        <button className={tab === "compare" ? "on" : ""} onClick={() => setTab("compare")}>איפה הכי זול</button>
      </nav>
      {dataError && <p className="banner warn">לא הצלחתי לטעון את המחירים: {dataError}</p>}
      {tab === "list" ? (
        <ListView items={items} data={data} add={add} update={update} remove={remove} />
      ) : data ? (
        <CompareView items={items} data={data} />
      ) : (
        <p className="muted">טוען מחירים…</p>
      )}
      {code && remoteConfigured && (
        <footer><button className="link" onClick={() => { clearCode(); setCode(null); }}>התנתק מהמכשיר הזה</button></footer>
      )}
    </div>
  );
}

function Lock({ onCode, error }: { onCode: (c: string) => void; error: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="app lock">
      <h1>רשימת קניות</h1>
      <p className="muted">הקלידו את קוד הבית, או פתחו את הקישור ששלחו לכם.</p>
      {error && <p className="banner warn">הקוד לא נכון. אותיות גדולות, רווחים ומקפים לא משנים, אבל כל תו אחר כן.</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onCode(v); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="קוד הבית" dir="ltr" autoComplete="off"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
        <button type="submit">כניסה</button>
      </form>
    </div>
  );
}

interface ListProps {
  items: Item[];
  data: Data | null;
  add: (i: Item) => void;
  update: (i: Item) => void;
  remove: (id: string) => void;
}

function ListView({ items, data, add, update, remove }: ListProps) {
  const [q, setQ] = useState("");
  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const sugg = useMemo(() => (index ? search(index, q) : []), [index, q]);
  const [editing, setEditing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const base = { qty: 1, checked: false, exclude: "" };
  const addSug = (s: Suggestion) => {
    add(s.kind === "weighted"
      ? { ...base, id: uid(), text: s.keyword!, kind: "weighted", keyword: s.keyword }
      : { ...base, id: uid(), text: s.label, kind: "barcode", barcode: s.barcode });
    setQ("");
  };
  const addFree = () => {
    if (!q.trim()) return;
    add({ ...base, id: uid(), text: q.trim(), kind: "free" });
    setQ("");
  };

  const handleCode = (raw: string): ScanResult => {
    if (!index || !data) return { ok: false, message: "המחירים עדיין נטענים, נסו שוב" };
    const code = findBarcode(index, raw);
    if (!code) return { ok: false, raw, message: `ברקוד ${raw} לא נמצא בחנויות באזור` };
    const name = data.names[code];
    const existing = items.find((i) => i.kind === "barcode" && i.barcode === code);
    if (existing) {
      update({ ...existing, checked: false, qty: existing.checked ? existing.qty : existing.qty + 1 });
      return { ok: true, message: `${name}: ${existing.checked ? "הוחזר לרשימה" : "הכמות עודכנה"}` };
    }
    add({ ...base, id: uid(), text: name, kind: "barcode", barcode: code });
    return { ok: true, message: `נוסף: ${name}` };
  };
  const addNamed = (raw: string, name: string) => add({ ...base, id: uid(), text: `${name} (ברקוד ${raw})`, kind: "free" });

  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  const row = (it: Item) => {
    const step = it.kind === "weighted" ? 0.5 : 1;
    const unit = it.kind === "weighted" ? 'ק"ג' : "יח'";
    const sub =
      it.kind === "free" ? "ללא מחיר (טקסט חופשי)"
      : it.kind === "weighted" ? `לפי משקל: "${it.keyword}"`
      : data?.names[it.barcode ?? ""] && data.names[it.barcode!] !== it.text ? data.names[it.barcode!] : "";
    return (
      <li key={it.id} className={it.checked ? "done" : ""}>
        <div className="r">
          <input type="checkbox" checked={it.checked} onChange={() => update({ ...it, checked: !it.checked })} aria-label="סמן" />
          <div className="t" onClick={() => it.kind === "weighted" && setEditing(editing === it.id ? null : it.id)}>
            <span>{it.text}</span>
            {sub && <small>{sub}</small>}
          </div>
          <div className="q">
            <button onClick={() => update({ ...it, qty: Math.max(step, +(it.qty - step).toFixed(1)) })} aria-label="פחות">−</button>
            <span>{it.qty} {unit}</span>
            <button onClick={() => update({ ...it, qty: +(it.qty + step).toFixed(1) })} aria-label="יותר">+</button>
          </div>
          <button className="x" onClick={() => remove(it.id)} aria-label="מחק">×</button>
        </div>
        {editing === it.id && it.kind === "weighted" && (
          <div className="edit">
            <label>מילת חיפוש<input defaultValue={it.keyword} onBlur={(e) => update({ ...it, keyword: e.target.value.trim() || it.keyword })} /></label>
            <label>להחריג (מופרדים בפסיק)<input defaultValue={it.exclude} onBlur={(e) => update({ ...it, exclude: e.target.value })} /></label>
          </div>
        )}
      </li>
    );
  };

  return (
    <section>
      <form className="add" onSubmit={(e) => { e.preventDefault(); sugg.length ? addSug(sugg[0]) : addFree(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="מה להוסיף? למשל חלב, מלפפון…" enterKeyHint="done" />
        <button type="submit" disabled={!q.trim()}>הוסף</button>
      </form>
      <button type="button" className="scan" onClick={() => setScanning(true)}>📷 סריקת ברקוד של מוצר</button>
      {scanning && <Scanner onCode={handleCode} onUnknownNamed={addNamed} onClose={() => setScanning(false)} />}
      {q.trim() && (
        <ul className="sugg">
          {sugg.map((s, k) => (
            <li key={k}><button onClick={() => addSug(s)}><span>{s.label}</span><small>{s.stores} חנויות</small></button></li>
          ))}
          <li><button onClick={addFree}><span>הוסף "{q.trim()}" כטקסט חופשי</span><small>בלי מחיר</small></button></li>
        </ul>
      )}
      {!items.length && !q && <p className="muted">הרשימה ריקה. התחילו להקליד כדי להוסיף מוצר.</p>}
      <ul className="items">{todo.map(row)}</ul>
      {done.length > 0 && (<><h3>בעגלה</h3><ul className="items">{done.map(row)}</ul></>)}
    </section>
  );
}

function CompareView({ items, data }: { items: Item[]; data: Data }) {
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const c: Comparison = useMemo(() => compare(data, items, overrides), [data, items, overrides]);
  const toggle = (i: number) => {
    const m = new Map(overrides);
    m.set(i, !c.visible.includes(i));
    setOverrides(m);
  };

  if (!c.items.length)
    return <p className="muted">הוסיפו לרשימה מוצרים עם מחיר (לא טקסט חופשי) כדי לראות השוואה.</p>;

  const vis = c.visible.map((i) => c.results[i]);
  const sorted = [...vis].sort((a, b) => a.fairTotal - b.fairTotal);
  const best = sorted[0]?.fairTotal ?? 0;

  return (
    <section className="cmp">
      {c.winner ? (
        <div className="win">
          <small>{c.winnerFull ? "הכי זול לכל הרשימה" : "הכי זול (לא כל הפריטים קיימים שם)"}</small>
          <h2>{c.winner.store.name}</h2>
          <p>{c.winner.store.address} · {c.winner.store.band}</p>
          <strong>{shekel(c.winnerFull ? c.winner.total : c.winner.fairTotal)}</strong>
          {!c.winnerFull && <p className="muted">חסרים שם: {c.items.filter((_, k) => c.winner!.lines[k].price == null).map((i) => i.text).join(", ") || "—"}</p>}
        </div>
      ) : <p className="muted">אין חנות שמכסה את הרשימה. הציגו עוד חנויות למטה.</p>}

      <h3>השוואה הוגנת</h3>
      <p className="muted">
        רק על {c.fairItems.length} פריטים שקיימים בכל החנויות המוצגות
        {c.fairItems.length < c.items.length ? ` (מתוך ${c.items.length})` : ""}.
      </p>
      <ul className="stores">
        {sorted.map((r) => (
          <li key={r.store.key}>
            <details>
              <summary>
                <span className="n">{r.store.name}<small>{r.store.band}</small></span>
                <span className="p">
                  <b>{shekel(r.fairTotal)}</b>
                  {r.fairTotal > best && <small>+{(((r.fairTotal / best) - 1) * 100).toFixed(1)}%</small>}
                </span>
              </summary>
              <p className="muted">{r.store.address}. נמצאו {r.found} מתוך {c.items.length}. סך הפריטים שנמצאו: {shekel(r.total)}</p>
              <table><tbody>
                {c.items.map((it, k) => (
                  <tr key={it.id} className={r.lines[k].price == null ? "miss" : ""}>
                    <td>{it.text}{r.lines[k].label && <small>{r.lines[k].label}</small>}</td>
                    <td>{r.lines[k].price == null ? "חסר" : shekel(r.lines[k].price!)}</td>
                  </tr>
                ))}
              </tbody></table>
            </details>
          </li>
        ))}
      </ul>

      {c.split.length > 1 && (
        <>
          <h3>פיצול הסל</h3>
          <p className="muted">הזול ביותר לכל פריט, בחנויות המוצגות: {shekel(c.splitTotal)}
            {c.winner && c.winnerFull && c.splitTotal < c.winner.total ? ` (חיסכון של ${shekel(c.winner.total - c.splitTotal)} לעומת חנות אחת)` : ""}</p>
          <ul className="split">
            {c.split.map((s) => (
              <li key={s.store.key}>
                <b>{s.store.name}</b> <span>{shekel(s.total)}</span>
                <small>{s.items.map((x) => x.item.text).join(", ")}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {c.skippedItems.length > 0 && <p className="muted">לא נמצאו באף חנות: {c.skippedItems.map((i) => i.text).join(", ")}</p>}
      {c.unpriced.length > 0 && <p className="muted">ללא מחיר (טקסט חופשי): {c.unpriced.map((i) => i.text).join(", ")}</p>}

      <h3>אילו חנויות להציג</h3>
      <div className="chips">
        {c.results.map((r) => (
          <button key={r.store.key} className={c.visible.includes(r.index) ? "on" : ""} onClick={() => toggle(r.index)}>
            {r.store.name} · {Math.round(r.coverage * 100)}%
          </button>
        ))}
      </div>
      <p className="muted">האחוז הוא כמה מהרשימה החנות מוכרת. כברירת מחדל מוצגות חנויות עם 70% ומעלה.</p>

      <p className="foot">
        מחירי מדף בלבד, בלי מבצעים ומועדון. מחירים מתאריך {data.meta.date}.
        {data.meta.missing.length > 0 && ` לא פרסמו היום: ${data.meta.missing.map((m) => m.name).join(", ")}.`}
        {" "}ההתאמה לפריטים לפי משקל היא קירוב, ובדקו את שם המוצר שנבחר.
      </p>
    </section>
  );
}
