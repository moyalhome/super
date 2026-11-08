import { useEffect, useRef, useState } from "react";

/**
 * Product photos come from Open Food Facts (an open database, photos under CC BY-SA), looked up by barcode.
 * Only part of the Israeli products have a photo, so every product also gets an emoji for its department.
 *
 * The service rate-limits (it answered 429 at about one request per second), so lookups are:
 *  - lazy: only for what is on screen, and dropped again if it scrolls away before its turn;
 *  - serial, with a pause between requests, and a cool-down after any 429 / server error;
 *  - cached in this browser (a photo for good, "no photo" for 30 days; failures are never cached).
 */

export const DEPT_EMOJI: Record<string, string> = {
  "ירקות ופירות": "🥬", "לחם ומאפים": "🥖", "בשר ועוף": "🍗", "דגים": "🐟", "חלב וביצים": "🥛",
  "קפואים": "🧊", "שימורים ויבשים": "🥫", "חטיפים ומתוקים": "🍫", "משקאות": "🥤", "ניקיון והיגיינה": "🧴", "אחר": "🛒",
};

const KEY = "super.img";
const RETRY_MISSING_AFTER = 30 * 24 * 3600 * 1000;
/** gap: about 45 requests a minute, below the documented 100/min with room to spare; cooldown: after a 429 or server error */
export const tune = { gap: 1300, cooldown: 90_000 };

type Entry = [string, number]; // [photo url or "" when there is none, when it was checked]
let cache: Record<string, Entry> | null = null;

function load(): Record<string, Entry> {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { cache = {}; }
  return cache!;
}
function save() {
  try {
    const all = Object.entries(load());
    if (all.length > 3000) cache = Object.fromEntries(all.slice(-2500));
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked: the cache is only an optimisation */ }
}
function forget(code: string) {
  delete load()[code];
  save();
}

const interest = new Map<string, number>();     // how many mounted cards still want this code
const waiters = new Map<string, ((url: string) => void)[]>();
const queue: string[] = [];
let running = false;
let nextAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const code = queue.shift()!;
      const done = (url: string) => { (waiters.get(code) ?? []).forEach((f) => f(url)); waiters.delete(code); };
      if (!(interest.get(code) ?? 0)) { done(""); continue; }          // scrolled away before its turn
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      if (!(interest.get(code) ?? 0)) { done(""); continue; }
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=image_front_small_url`);
        if (r.status === 429 || r.status >= 500) {
          nextAt = Date.now() + tune.cooldown;                         // back off, and try this one again later
          queue.unshift(code);
          continue;
        }
        const j = r.ok || r.status === 404 ? await r.json().catch(() => null) : null;
        const url: string = j?.product?.image_front_small_url ?? "";
        if (r.ok || r.status === 404) { load()[code] = [url, Date.now()]; save(); }
        done(url);
      } catch {
        nextAt = Date.now() + tune.cooldown / 3;                       // offline or blocked: do not hammer
        done("");
      }
      nextAt = Math.max(nextAt, Date.now() + tune.gap);
    }
  } finally { running = false; }
}

/** Resolves with the photo url, or "" if there is none (yet). Call release(code) when the card goes away. */
export function lookupImage(code: string): Promise<string> {
  const hit = load()[code];
  if (hit && (hit[0] || Date.now() - hit[1] < RETRY_MISSING_AFTER)) return Promise.resolve(hit[0]);
  interest.set(code, (interest.get(code) ?? 0) + 1);
  return new Promise((resolve) => {
    const list = waiters.get(code) ?? [];
    list.push(resolve);
    waiters.set(code, list);
    if (!queue.includes(code)) queue.push(code);
    void pump();
  });
}
export function release(code: string) {
  interest.set(code, Math.max(0, (interest.get(code) ?? 1) - 1));
}

export function ProductImg({ code, dept, size = 44 }: { code?: string; dept: string; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string>(() => (code ? load()[code]?.[0] ?? "" : ""));
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (!code || url) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let dead = false;
    let asked = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || asked) return;
      asked = true;
      io.disconnect();
      lookupImage(code).then((u) => { if (!dead && u) setUrl(u); });
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
      if (asked) release(code);
    };
  }, [code, url]);

  return (
    <span ref={ref} className="pimg" style={{ width: size, height: size }} aria-hidden="true">
      {url && !broken
        ? <img src={url} alt="" loading="lazy" onError={() => { setBroken(true); if (code) forget(code); }} />
        : <span className="emo" style={{ fontSize: size * 0.55 }}>{DEPT_EMOJI[dept] ?? "🛒"}</span>}
    </span>
  );
}
