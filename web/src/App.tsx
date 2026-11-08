import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadCode, Locked, canon, clearCode, clientId, getName, loadData, localBackend, readCode, remoteBackend, remoteConfigured,
  saveCode, setName as storeName, uid, type Backend, type Online, type SavedItem, type SavedList,
} from "./api";
import { compare, shekel, type Comparison, type StoreResult } from "./compare";
import { DEFAULT_DEPTS, OTHER, deptFor, deptKey, deptOptions, deptOrder, groupByDept } from "./departments";
import { buildIndex, findBarcode, search, type Suggestion } from "./search";
import Scanner, { type ScanResult } from "./Scanner";
import Picker from "./Picker";
import { ProductImg } from "./images";
import type { Data, HistoryEntry, Item } from "./types";

type Status = "loading" | "ok" | "offline" | "locked";
type Tab = "list" | "compare" | "saved";

export default function App() {
  const [code, setCode] = useState<string | null>(() => readCode());
  const backend = useMemo<Backend | null>(
    () => (remoteConfigured ? (code ? remoteBackend(code) : null) : localBackend()),
    [code],
  );
  const [items, setItems] = useState<Item[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [lockError, setLockError] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [dataError, setDataError] = useState("");
  const [tab, setTab] = useState<Tab>("list");
  const [name, setName] = useState(getName);
  const [renaming, setRenaming] = useState(false);
  const [online, setOnline] = useState<Online[]>([]);
  const [kv, setKv] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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

  const refreshLists = useCallback(async () => {
    if (!backend) return;
    try { setLists(await backend.lists()); } catch (e) { handleError(e); }
  }, [backend, handleError]);

  useEffect(() => {
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const t = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  useEffect(() => { if (tab === "saved") refreshLists(); }, [tab, refreshLists]);

  // remembered departments and their order: rarely change, so a slow refresh is enough
  useEffect(() => {
    if (!backend) return;
    const load = () => { if (!document.hidden) backend.kvAll().then(setKv).catch(handleError); };
    load();
    const t = setInterval(load, 30000);
    document.addEventListener("visibilitychange", load);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, [backend, handleError]);

  // what the household bought before, for one-tap re-adding
  const refreshHistory = useCallback(() => {
    if (backend) backend.history().then(setHistory).catch(handleError);
  }, [backend, handleError]);
  useEffect(() => {
    refreshHistory();
    const t = setInterval(() => { if (!document.hidden) refreshHistory(); }, 60000);
    return () => clearInterval(t);
  }, [refreshHistory]);

  // "I am here" heartbeat; the server answers with everyone seen in the last 45 seconds
  useEffect(() => {
    if (!backend?.shared || !name) return;
    const me = clientId();
    let stopped = false;
    const ping = async () => {
      if (document.hidden) return;
      try { const o = await backend.presence(me, name); if (!stopped) setOnline(o); } catch (e) { handleError(e); }
    };
    const onVisible = () => { if (document.hidden) backend.leave(me).catch(() => undefined); else ping(); };
    ping();
    const t = setInterval(ping, 15000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [backend, name, handleError]);

  const mutate = async (apply: (l: Item[]) => Item[], op: () => Promise<void>) => {
    setItems(apply);
    pending.current++;
    try { await op(); setStatus("ok"); } catch (e) { handleError(e); } finally {
      pending.current--;
      if (pending.current === 0) refresh();
    }
  };
  const add = (item: Item) => {
    const withDept = item.dept ? item : { ...item, dept: deptFor(item, kv) };
    return mutate((l) => [...l, withDept], () => backend!.upsert(withDept));
  };
  const update = (item: Item) => mutate((l) => l.map((x) => (x.id === item.id ? item : x)), () => backend!.upsert(item));
  const remove = (id: string) => mutate((l) => l.filter((x) => x.id !== id), () => backend!.remove(id));

  // changing an item's department is remembered for that product, for the whole household
  const setDept = (it: Item, dept: string) => {
    update({ ...it, dept });
    const key = deptKey(it);
    setKv((p) => ({ ...p, [key]: dept }));
    backend!.kvSet(key, dept).catch(handleError);
  };
  const saveOrder = (order: string[]) => {
    setKv((p) => ({ ...p, deptOrder: order }));
    backend!.kvSet("deptOrder", order).catch(handleError);
  };
  // putting an item in the cart counts as a purchase (this feeds "bought before")
  const toggleChecked = (it: Item) => {
    const becoming = !it.checked;
    update({ ...it, checked: becoming, checkedBy: becoming ? name : undefined });
    if (becoming) backend!.bump({ ...it, dept: it.dept ?? deptFor(it, kv) }).then(refreshHistory).catch(handleError);
  };

  const saveCurrent = async (name: string): Promise<string> => {
    const saved: SavedItem[] = items.map(({ id: _id, checked: _checked, addedBy: _a, checkedBy: _b, createdAt: _d, ...rest }) => rest);
    try {
      await backend!.saveList(name, saved);
      await refreshLists();
      return `נשמרה הרשימה "${name}" (${saved.length} פריטים)`;
    } catch (e) {
      handleError(e);
      return "השמירה נכשלה, נסו שוב";
    }
  };
  const deleteSaved = async (id: string) => {
    try { await backend!.deleteList(id); await refreshLists(); } catch (e) { handleError(e); }
  };
  const loadSaved = (list: SavedList): string => {
    let added = 0, already = 0;
    for (const si of list.items) {
      const match = items.find((i) => i.kind === si.kind &&
        (si.kind === "barcode" ? i.barcode === si.barcode : si.kind === "weighted" ? i.keyword === si.keyword : i.text === si.text));
      if (match) { already++; if (match.checked) update({ ...match, checked: false }); continue; }
      add({ ...si, id: uid(), checked: false, addedBy: name, createdAt: new Date().toISOString() });
      added++;
    }
    return `נוספו ${added} פריטים לרשימה` + (already ? `, ${already} כבר היו בה` : "");
  };

  if (!backend) {
    return <Lock error={lockError} onCode={(c) => { const k = canon(c); saveCode(k); setLockError(false); setCode(k); }} />;
  }

  if (!name || renaming) {
    return (
      <NamePrompt
        initial={name}
        onDone={(n) => { storeName(n); setName(n.trim().slice(0, 40)); setRenaming(false); }}
        onCancel={name ? () => setRenaming(false) : undefined}
      />
    );
  }

  const open = items.filter((i) => !i.checked).length;
  const statusText = status === "ok" ? "מחובר" : status === "offline" ? "אין חיבור" : status === "locked" ? "נעול זמנית" : "טוען";
  return (
    <div className="app">
      <header>
        <h1>רשימת קניות</h1>
        <span className={`dot ${status}`} role="img" aria-label={`מצב חיבור: ${statusText}`} title={statusText} />
      </header>
      <OnlineBar online={online} me={name} shared={backend.shared} onRename={() => setRenaming(true)} />
      <main>
        {!backend.shared && <p className="banner">מצב מקומי: הרשימה נשמרת רק במכשיר הזה.</p>}
        {status === "offline" && <p className="banner warn" role="alert">אין חיבור לשרת. נסו שוב בעוד רגע.</p>}
        {status === "locked" && <p className="banner warn" role="alert">יותר מדי ניסיונות כושלים לקוד, והגישה נעולה זמנית (עד שעה). נסו שוב מאוחר יותר.</p>}
        {dataError && <p className="banner warn" role="alert">לא הצלחתי לטעון את המחירים: {dataError}</p>}
        {tab === "list" && <ListView items={items} data={data} name={name} kv={kv} history={history} toggleChecked={toggleChecked} setDept={setDept} add={add} update={update} remove={remove} />}
        {tab === "compare" && (data ? <CompareView items={items} data={data} /> : <p className="muted center">טוען מחירים…</p>)}
        {tab === "saved" && (
          <SavedView lists={lists} hasItems={items.length > 0} order={deptOrder(kv)} onOrder={saveOrder} onSave={saveCurrent} onLoad={loadSaved} onDelete={deleteSaved} />
        )}
        {code && remoteConfigured && (
          <footer><button className="link" onClick={() => { clearCode(); setCode(null); }}>התנתקות מהמכשיר הזה</button></footer>
        )}
      </main>
      <nav className="tabbar" aria-label="ניווט ראשי">
        <button aria-current={tab === "list" ? "page" : undefined} onClick={() => setTab("list")}>
          <span aria-hidden="true">📝</span>רשימה ({open})
        </button>
        <button aria-current={tab === "compare" ? "page" : undefined} onClick={() => setTab("compare")}>
          <span aria-hidden="true">🛒</span>איפה הכי זול
        </button>
        <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => setTab("saved")}>
          <span aria-hidden="true">📂</span>שמורות
        </button>
      </nav>
    </div>
  );
}

function Lock({ onCode, error }: { onCode: (c: string) => void; error: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="app lock">
      <h1>רשימת קניות</h1>
      <p className="muted center">הקלידו את קוד הבית, או פתחו את הקישור ששלחו לכם.</p>
      {error && <p className="banner warn" role="alert">הקוד לא נכון. אותיות גדולות, רווחים ומקפים לא משנים, אבל כל תו אחר כן.</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onCode(v); }}>
        <label className="sr" htmlFor="code">קוד הבית</label>
        <input id="code" value={v} onChange={(e) => setV(e.target.value)} placeholder="קוד הבית" dir="ltr" autoComplete="off"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
        <button type="submit">כניסה</button>
      </form>
    </div>
  );
}

interface ListProps {
  items: Item[];
  data: Data | null;
  name: string;
  kv: Record<string, unknown>;
  history: HistoryEntry[];
  toggleChecked: (i: Item) => void;
  setDept: (i: Item, dept: string) => void;
  add: (i: Item) => void;
  update: (i: Item) => void;
  remove: (id: string) => void;
}

function ListView({ items, data, name, kv, history, toggleChecked, setDept, add, update, remove }: ListProps) {
  const [q, setQ] = useState("");
  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const sugg = useMemo(() => (index ? search(index, q) : []), [index, q]);
  const [editing, setEditing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const base = { qty: 1, checked: false, exclude: "", addedBy: name, createdAt: new Date().toISOString() };
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
      update({ ...existing, checked: false, checkedBy: undefined, qty: existing.checked ? existing.qty : existing.qty + 1 });
      return { ok: true, message: `${name}: ${existing.checked ? "הוחזר לרשימה" : "הכמות עודכנה"}` };
    }
    add({ ...base, id: uid(), text: name, kind: "barcode", barcode: code });
    return { ok: true, message: `נוסף: ${name}` };
  };
  const addNamed = (raw: string, name: string) => add({ ...base, id: uid(), text: `${name} (ברקוד ${raw})`, kind: "free" });

  const addWeightedKw = (kw: string): string => {
    const ex = items.find((i) => i.kind === "weighted" && i.keyword === kw);
    if (ex) {
      update({ ...ex, checked: false, checkedBy: undefined, qty: ex.checked ? ex.qty : ex.qty + 1 });
      return `${kw}: ${ex.checked ? "הוחזר לרשימה" : "הכמות עודכנה"}`;
    }
    add({ ...base, id: uid(), text: kw, kind: "weighted", keyword: kw });
    return `נוסף: ${kw}`;
  };
  const sameAsHistory = (i: Item, h: HistoryEntry) =>
    i.kind === h.kind && (h.kind === "barcode" ? i.barcode === h.barcode : h.kind === "weighted" ? i.keyword === h.keyword : i.text === h.text);
  const addHistory = (h: HistoryEntry): string => {
    const ex = items.find((i) => sameAsHistory(i, h));
    if (ex) {
      if (ex.checked) update({ ...ex, checked: false, checkedBy: undefined });
      return `${h.text}: כבר ברשימה`;
    }
    add({ ...base, id: uid(), text: h.text, kind: h.kind, barcode: h.barcode ?? undefined, keyword: h.keyword ?? undefined,
      qty: h.qty || 1, dept: h.dept ?? undefined });
    return `נוסף: ${h.text}`;
  };
  const quick = history.filter((h) => !items.some((i) => sameAsHistory(i, h))).slice(0, items.length ? 8 : 12);

  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const order = deptOrder(kv);
  const deptOf = (i: Item) => i.dept ?? deptFor(i, kv);

  const row = (it: Item) => {
    const dep = deptOf(it);
    const step = it.kind === "weighted" ? 0.5 : 1;
    const unit = it.kind === "weighted" ? 'ק"ג' : "יח'";
    const sub =
      it.kind === "free" ? "ללא מחיר (טקסט חופשי)"
      : it.kind === "weighted" ? `לפי משקל: "${it.keyword}"`
      : data?.names[it.barcode ?? ""] && data.names[it.barcode!] !== it.text ? data.names[it.barcode!] : "";
    return (
      <li key={it.id} className={it.checked ? "done" : ""}>
        <div className="r">
          <label className="chk">
            <input type="checkbox" checked={it.checked} onChange={() => toggleChecked(it)} />
            <span className="sr">{it.checked ? "החזרה לרשימה" : "סימון כבעגלה"}: {it.text}</span>
          </label>
          <div className="t">
            <ProductImg code={it.kind === "barcode" ? it.barcode : undefined} dept={dep} size={40} />
            <span>{it.text}</span>
            {sub && <small>{sub}</small>}
            {(it.addedBy || it.checkedBy) && (
              <small className="by">
                {it.addedBy ? `נוסף על ידי ${it.addedBy}${it.createdAt ? ` · ${ago(it.createdAt)}` : ""}` : ""}
                {it.checked && it.checkedBy ? `${it.addedBy ? " · " : ""}נלקח על ידי ${it.checkedBy}` : ""}
              </small>
            )}
          </div>
          <button className="x" onClick={() => remove(it.id)} aria-label={`מחיקה: ${it.text}`}>×</button>
          <div className="ctl">
            <div className="q" role="group" aria-label={`כמות: ${it.text}`}>
              <button onClick={() => update({ ...it, qty: Math.max(step, +(it.qty - step).toFixed(1)) })} aria-label={`הפחתת כמות: ${it.text}`}>−</button>
              <span aria-live="polite">{it.qty} {unit}</span>
              <button onClick={() => update({ ...it, qty: +(it.qty + step).toFixed(1) })} aria-label={`הגדלת כמות: ${it.text}`}>+</button>
            </div>
            <select className={`dsel${dep === OTHER ? " other" : ""}`} value={dep} aria-label={`מחלקה: ${it.text}`}
              onChange={(e) => setDept(it, e.target.value)}>
              {deptOptions(order, dep).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {it.kind === "weighted" && (
              <button className="ghost" aria-expanded={editing === it.id} onClick={() => setEditing(editing === it.id ? null : it.id)}>עריכה</button>
            )}
          </div>
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
    <section aria-label="הרשימה שלי">
      <form className="add" onSubmit={(e) => { e.preventDefault(); sugg.length ? addSug(sugg[0]) : addFree(); }}>
        <label className="sr" htmlFor="add">הוספת מוצר</label>
        <input id="add" value={q} onChange={(e) => setQ(e.target.value)} placeholder="מה להוסיף? למשל חלב, מלפפון…" enterKeyHint="done" autoComplete="off" />
        <button type="submit" disabled={!q.trim()}>הוסף</button>
      </form>
      <div className="tools">
        <button type="button" className="scan" onClick={() => setScanning(true)}>📷 סריקת ברקוד</button>
        <button type="button" className="scan" onClick={() => setBrowsing(true)} disabled={!index}>🔎 עיון במוצרים</button>
      </div>
      {scanning && <Scanner onCode={handleCode} onUnknownNamed={addNamed} onClose={() => setScanning(false)} />}
      {browsing && data && index && (
        <Picker data={data} index={index} items={items} order={order} kv={kv} history={history} initialQuery={q}
          onAddCode={(code) => handleCode(code).message} onAddWeighted={addWeightedKw} onAddHistory={addHistory}
          onClose={() => { setBrowsing(false); setQ(""); }} />
      )}
      {q.trim() && (
        <ul className="sugg" aria-label="הצעות">
          {sugg.map((s, k) => (
            <li key={k}><button onClick={() => addSug(s)}><span>{s.label}</span><small>{s.stores} חנויות</small></button></li>
          ))}
          <li><button onClick={() => setBrowsing(true)}><span>הצגת כל האפשרויות ל"{q.trim()}"</span><small>עם מחירים ויצרן</small></button></li>
          <li><button onClick={addFree}><span>הוסף "{q.trim()}" כטקסט חופשי</span><small>בלי מחיר</small></button></li>
        </ul>
      )}
      {!q.trim() && quick.length > 0 && (
        <section className="quick" aria-label="קניתם בעבר">
          <h2 className="h">קניתם בעבר: הוספה בלחיצה</h2>
          <div className="chips">
            {quick.map((h) => (
              <button key={h.key} type="button" onClick={() => addHistory(h)} aria-label={`הוספה: ${h.text}`}>+ {h.text}</button>
            ))}
          </div>
        </section>
      )}
      {!items.length && !q && <p className="muted center">הרשימה ריקה. הקלידו שם מוצר, סרקו ברקוד או עיינו במוצרים.</p>}
      {groupByDept(todo, order, deptOf).map(([dept, list]) => (
        <div key={dept} className="dept">
          <h2 className={`dh${dept === OTHER ? " other" : ""}`}>{dept} <span>({list.length})</span></h2>
          {dept === OTHER && <p className="muted">לא זיהינו את המחלקה. בחרו מחלקה, והאתר יזכור אותה.</p>}
          <ul className="items">{list.map(row)}</ul>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <h2 className="h">בעגלה ({done.length})</h2>
          <ul className="items">{done.map(row)}</ul>
          <button className="wide" onClick={() => { if (window.confirm(`למחוק ${done.length} פריטים שבעגלה מהרשימה?`)) done.forEach((d) => remove(d.id)); }}>
            ניקוי הפריטים שבעגלה
          </button>
        </>
      )}
    </section>
  );
}

function StoreRow({ r, c, base }: { r: StoreResult; c: Comparison; base?: number }) {
  const full = r.missing.length === 0;
  const pct = base && r.total > base ? ((r.total / base - 1) * 100).toFixed(1) : null;
  return (
    <li>
      <details>
        <summary>
          <span className="n">{r.store.name}<small>{r.store.band}{r.store.approx ? " · מיקום משוער" : ""}</small></span>
          <span className="p">
            <b>{shekel(r.total)}</b>
            {full ? (pct && <small>+{pct}%</small>) : <small>חסרים {r.missing.length}</small>}
          </span>
        </summary>
        <p className="muted">{r.store.address}</p>
        {!full && <p className="warn">חסרים: {r.missing.map((i) => i.text).join(", ")}</p>}
        <table>
          <caption className="sr">פירוט המחירים ב{r.store.name}</caption>
          <tbody>
            {c.items.map((it, k) => (
              <tr key={it.id} className={r.lines[k].price == null ? "miss" : ""}>
                <td>{it.text}{r.lines[k].label && <small>{r.lines[k].label}</small>}</td>
                <td>{r.lines[k].price == null ? "חסר" : shekel(r.lines[k].price!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </li>
  );
}

const SPLITS: { max: number; label: string }[] = [
  { max: 2, label: "עד 2 חנויות" },
  { max: 3, label: "עד 3 חנויות" },
  { max: 0, label: "בלי הגבלה" },
];

function CompareView({ items, data }: { items: Item[]; data: Data }) {
  const [splitMax, setSplitMax] = useState(2);
  const [onlyFull, setOnlyFull] = useState(false);
  const c: Comparison = useMemo(() => compare(data, items, splitMax), [data, items, splitMax]);

  if (!items.some((i) => !i.checked && i.kind !== "free"))
    return <p className="muted center">הוסיפו לרשימה מוצרים עם מחיר (לא טקסט חופשי) כדי לראות השוואה.</p>;
  if (!c.items.length)
    return <p className="muted center">אף אחד מהמוצרים ברשימה לא נמצא בחנויות באזור: {c.notFound.map((i) => i.text).join(", ")}</p>;

  const cheapest = c.full[0]?.total;
  const priciest = c.full.length > 1 ? c.full[c.full.length - 1].total : undefined;
  const w = c.winner;

  return (
    <section aria-label="השוואת מחירים">
      {w ? (
        <div className="win">
          <small>{c.full.length ? "הכי זול, ויש בו את כל הרשימה" : "אין חנות שיש בה את כל הרשימה. הכי קרוב:"}</small>
          <h2>{w.store.name}</h2>
          <p>{w.store.address} · {w.store.band}</p>
          <strong>{shekel(w.total)}</strong>
          {!c.full.length && <p>חסרים שם: {w.missing.map((i) => i.text).join(", ")}</p>}
          {cheapest != null && priciest != null && priciest > cheapest && (
            <p>חיסכון של {shekel(priciest - cheapest)} לעומת החנות היקרה מבין {c.full.length} החנויות שיש בהן הכול</p>
          )}
        </div>
      ) : <p className="muted center">לא נמצאו חנויות.</p>}

      <h2 className="h">חנויות שיש בהן את כל הרשימה ({c.full.length})</h2>
      {c.full.length
        ? <ul className="stores">{c.full.map((r) => <StoreRow key={r.store.key} r={r} c={c} base={cheapest} />)}</ul>
        : <p className="muted center">אין חנות כזו כרגע. החנויות שחסר בהן הכי מעט מופיעות למטה.</p>}

      <label className="check">
        <input type="checkbox" checked={onlyFull} onChange={(e) => setOnlyFull(e.target.checked)} />
        הצגת חנויות עם הרשימה המלאה בלבד
      </label>

      {!onlyFull && c.partial.length > 0 && (
        <>
          <h2 className="h">חנויות שחסרים בהן פריטים ({c.partial.length})</h2>
          <p className="muted center">הסכום הוא רק על מה שנמצא בחנות, ולכן לא ניתן להשוות אותו ישירות.</p>
          <ul className="stores">{c.partial.map((r) => <StoreRow key={r.store.key} r={r} c={c} />)}</ul>
        </>
      )}

      <h2 className="h">פיצול הסל</h2>
      <div className="seg" role="radiogroup" aria-label="מספר חנויות מקסימלי לפיצול">
        {SPLITS.map((s) => (
          <button key={s.max} role="radio" aria-checked={splitMax === s.max} onClick={() => setSplitMax(s.max)}>{s.label}</button>
        ))}
      </div>
      <p className="muted center">
        הזול ביותר לכל פריט, כשקונים ב{splitMax ? `עד ${splitMax} חנויות` : "כמה חנויות שצריך"}: <b>{shekel(c.split.total)}</b>
        {cheapest != null && c.split.uncovered.length === 0 && c.split.total < cheapest ? ` (חיסכון של ${shekel(cheapest - c.split.total)} לעומת החנות הזולה עם הרשימה המלאה)` : ""}
      </p>
      <ul className="split">
        {c.split.stores.map((s) => (
          <li key={s.store.key}>
            <b>{s.store.name}</b> <span>{shekel(s.total)}</span>
            <small>{s.items.map((x) => x.item.text).join(", ")}</small>
          </li>
        ))}
      </ul>
      {c.split.uncovered.length > 0 && <p className="muted center">לא נכללו בפיצול: {c.split.uncovered.map((i) => i.text).join(", ")}</p>}
      {c.notFound.length > 0 && <p className="muted center">לא נמצאו באף חנות: {c.notFound.map((i) => i.text).join(", ")}</p>}
      {c.unpriced.length > 0 && <p className="muted center">ללא מחיר (טקסט חופשי): {c.unpriced.map((i) => i.text).join(", ")}</p>}

      <p className="foot">
        מחירי מדף בלבד, בלי מבצעים ומועדון. מחירים מתאריך {data.meta.date}.
        {data.meta.missing.length > 0 && ` לא פרסמו היום: ${data.meta.missing.map((m) => m.name).join(", ")}.`}
        {" "}ההתאמה לפריטים לפי משקל היא קירוב, ובדקו את שם המוצר שנבחר.
      </p>
    </section>
  );
}

interface SavedProps {
  lists: SavedList[];
  hasItems: boolean;
  order: string[];
  onOrder: (o: string[]) => void;
  onSave: (name: string) => Promise<string>;
  onLoad: (l: SavedList) => string;
  onDelete: (id: string) => Promise<void>;
}

function SavedView({ lists, hasItems, order, onOrder, onSave, onLoad, onDelete }: SavedProps) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (lists.some((l) => l.name === n) && !window.confirm(`כבר קיימת רשימה בשם "${n}". להחליף אותה?`)) return;
    setMsg(await onSave(n));
    setName("");
  };
  return (
    <section aria-label="רשימות שמורות">
      <h2 className="h">שמירת הרשימה הנוכחית</h2>
      <form className="add" onSubmit={submit}>
        <label className="sr" htmlFor="listname">שם הרשימה</label>
        <input id="listname" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: קניות חודשיות" autoComplete="off" />
        <button type="submit" disabled={!name.trim() || !hasItems}>שמירה</button>
      </form>
      <div className="chips" aria-label="שמות מוצעים">
        {["השלמות שוטף", "קניות חודשיות", "שבת וחג"].map((n) => (
          <button key={n} type="button" onClick={() => setName(n)}>{n}</button>
        ))}
      </div>
      {!hasItems && <p className="muted center">הרשימה הנוכחית ריקה, אין מה לשמור.</p>}
      <p className="muted center" role="status" aria-live="polite">{msg}</p>

      <DeptEditor order={order} onSave={onOrder} />

      <h2 className="h">הרשימות השמורות ({lists.length})</h2>
      {!lists.length && <p className="muted center">עדיין אין רשימות שמורות.</p>}
      <ul className="saved">
        {lists.map((l) => (
          <li key={l.id}>
            <details>
              <summary><b>{l.name}</b><small>{l.items.length} פריטים</small></summary>
              <ul className="plain">{l.items.map((it, k) => <li key={k}>{it.text}{it.qty !== 1 ? ` × ${it.qty}` : ""}</li>)}</ul>
            </details>
            <div className="acts">
              <button className="primary" onClick={() => setMsg(onLoad(l))}>הוספה לרשימה</button>
              <button onClick={() => { if (window.confirm(`למחוק את "${l.name}"?`)) onDelete(l.id); }}>מחיקה</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "לפני 5 דק'", "לפני שעתיים": how long ago, in plain Hebrew. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "הרגע";
  if (mins < 60) return `לפני ${mins} דק'`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? "אתמול" : `לפני ${d} ימים`;
}

function OnlineBar({ online, me, shared, onRename }: { online: Online[]; me: string; shared: boolean; onRename: () => void }) {
  const names = [...new Set(online.map((o) => o.name))];
  const others = names.filter((n) => n !== me);
  return (
    <div className="online" role="status" aria-live="polite">
      {shared && (
        <span>
          {others.length === 0
            ? "רק אתם מחוברים עכשיו"
            : `${others.length + 1} מחוברים עכשיו: ${[`${me} (אתם)`, ...others].join(", ")}`}
        </span>
      )}
      <button className="link" onClick={onRename}>{shared ? "שינוי שם" : `שלום ${me}, שינוי שם`}</button>
    </div>
  );
}

function NamePrompt({ initial, onDone, onCancel }: { initial: string; onDone: (n: string) => void; onCancel?: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="app lock">
      <h1>איך קוראים לך?</h1>
      <p className="muted center">השם יוצג לשאר בני הבית: מי מחובר עכשיו, ומי הוסיף כל מוצר.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onDone(v); }}>
        <label className="sr" htmlFor="myname">השם שלך</label>
        <input id="myname" value={v} onChange={(e) => setV(e.target.value)} placeholder="למשל: אבא" maxLength={40} autoComplete="given-name" autoFocus />
        <button type="submit" disabled={!v.trim()}>המשך</button>
      </form>
      {onCancel && <button className="link" onClick={onCancel}>ביטול</button>}
    </div>
  );
}

function DeptEditor({ order, onSave }: { order: string[]; onSave: (o: string[]) => void }) {
  const [nv, setNv] = useState("");
  const move = (i: number, d: number) => {
    const o = [...order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    onSave(o);
  };
  const addDept = (e: React.FormEvent) => {
    e.preventDefault();
    const n = nv.trim().slice(0, 40);
    if (!n || n === OTHER || order.includes(n)) return;
    onSave([...order, n]);
    setNv("");
  };
  return (
    <details className="deptedit">
      <summary><b>סדר המחלקות בסופר</b><small>{order.length} מחלקות</small></summary>
      <p className="muted">הרשימה מוצגת לפי הסדר הזה, כמו שעוברים בחנות. "{OTHER}" תמיד בסוף.</p>
      <ol>
        {order.map((d, i) => (
          <li key={d}>
            <span>{d}</span>
            <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`הזזה למעלה: ${d}`}>↑</button>
            <button disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`הזזה למטה: ${d}`}>↓</button>
            <button onClick={() => { if (window.confirm(`להסיר את "${d}" מהסדר? פריטים בה יופיעו בסוף.`)) onSave(order.filter((x) => x !== d)); }} aria-label={`הסרה: ${d}`}>×</button>
          </li>
        ))}
      </ol>
      <form className="add" onSubmit={addDept}>
        <label className="sr" htmlFor="newdept">מחלקה חדשה</label>
        <input id="newdept" value={nv} onChange={(e) => setNv(e.target.value)} placeholder="מחלקה חדשה, למשל: מעדנייה" autoComplete="off" />
        <button type="submit" disabled={!nv.trim()}>הוספה</button>
      </form>
      <button className="wide" onClick={() => onSave(DEFAULT_DEPTS)}>איפוס לסדר ברירת המחדל</button>
    </details>
  );
}
