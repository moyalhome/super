import { useEffect, useRef, useState } from "react";

/**
 * Product photos come from Open Food Facts (an open database, photos under CC BY-SA), looked up by barcode.
 * Only about a quarter of the popular Israeli products have one, so every product also gets an emoji for its
 * department. Lookups are lazy (only for what is on screen), throttled, and cached in this browser.
 */

export const DEPT_EMOJI: Record<string, string> = {
  "ירקות ופירות": "🥬", "לחם ומאפים": "🥖", "בשר ועוף": "🍗", "דגים": "🐟", "חלב וביצים": "🥛",
  "קפואים": "🧊", "שימורים ויבשים": "🥫", "חטיפים ומתוקים": "🍫", "משקאות": "🥤", "ניקיון והיגיינה": "🧴", "אחר": "🛒",
};

const KEY = "super.img";
const RETRY_MISSING_AFTER = 30 * 24 * 3600 * 1000;
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

const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<string>>();
const slot = () => new Promise<void>((go) => {
  const start = () => { running++; go(); };
  if (running < MAX_PARALLEL) start(); else waiting.push(start);
});
const release = () => { running--; setTimeout(() => waiting.shift()?.(), 250); };

export function lookupImage(code: string): Promise<string> {
  const hit = load()[code];
  if (hit && (hit[0] || Date.now() - hit[1] < RETRY_MISSING_AFTER)) return Promise.resolve(hit[0]);
  let p = inflight.get(code);
  if (!p) {
    p = (async () => {
      await slot();
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=image_front_small_url`);
        if (!r.ok) return "";
        const j = await r.json();
        const url: string = j?.product?.image_front_small_url ?? "";
        load()[code] = [url, Date.now()];
        save();
        return url;
      } catch { return ""; } finally { release(); inflight.delete(code); }
    })();
    inflight.set(code, p);
  }
  return p;
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
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      lookupImage(code).then((u) => { if (!dead && u) setUrl(u); });
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => { dead = true; io.disconnect(); };
  }, [code, url]);

  return (
    <span ref={ref} className="pimg" style={{ width: size, height: size }} aria-hidden="true">
      {url && !broken
        ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span className="emo" style={{ fontSize: size * 0.55 }}>{DEPT_EMOJI[dept] ?? "🛒"}</span>}
    </span>
  );
}
