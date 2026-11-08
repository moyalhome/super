import type { Data, Item } from "./types";

const SB_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const CODE_KEY = "super.code";
const LOCAL_KEY = "super.list";

export const remoteConfigured = Boolean(SB_URL && SB_KEY);

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

/** Phones capitalise, add spaces and dashes: compare only lowercase letters and digits. */
export const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A link like https://host/super/#code=XYZ signs in once; the code is stored locally and removed from the address bar. */
export function readCode(): string | null {
  const m = location.hash.match(/code=([^&]+)/);
  if (m) {
    store.set(CODE_KEY, canon(decodeURIComponent(m[1])));
    history.replaceState(null, "", location.pathname + location.search);
  }
  return store.get(CODE_KEY);
}
export const saveCode = (c: string) => store.set(CODE_KEY, c);
export const clearCode = () => store.del(CODE_KEY);

export class BadCode extends Error {}

export interface Backend {
  shared: boolean;
  list(): Promise<Item[]>;
  upsert(item: Item): Promise<void>;
  remove(id: string): Promise<void>;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const t = await r.text();
    if (t.includes("bad_code")) throw new BadCode();
    throw new Error(`${fn}: ${r.status} ${t.slice(0, 120)}`);
  }
  return (await r.json()) as T;
}

export function remoteBackend(code: string): Backend {
  return {
    shared: true,
    list: async () => (await rpc<Item[]>("list_get", { p_code: code })) ?? [],
    upsert: async (item) => void (await rpc("item_upsert", { p_code: code, p_item: item })),
    remove: async (id) => void (await rpc("item_delete", { p_code: code, p_id: id })),
  };
}

/** Used when no database is configured (local preview): the list lives only in this browser. */
export function localBackend(): Backend {
  const read = (): Item[] => { try { return JSON.parse(store.get(LOCAL_KEY) ?? "[]"); } catch { return []; } };
  const write = (l: Item[]) => store.set(LOCAL_KEY, JSON.stringify(l));
  return {
    shared: false,
    list: async () => read(),
    upsert: async (item) => { const l = read().filter((i) => i.id !== item.id); l.push(item); write(l); },
    remove: async (id) => write(read().filter((i) => i.id !== id)),
  };
}

const base = import.meta.env.BASE_URL;
const j = async <T,>(f: string): Promise<T> => {
  const r = await fetch(`${base}data/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json() as Promise<T>;
};

export async function loadData(): Promise<Data> {
  const [stores, prices, names, weighted, meta] = await Promise.all([
    j<Data["stores"]>("stores.json"),
    j<{ p: Data["prices"] }>("prices.json"),
    j<Data["names"]>("names.json"),
    j<{ w: Data["weighted"] }>("weighted.json"),
    j<Data["meta"]>("meta.json"),
  ]);
  return { stores, prices: prices.p, names, weighted: weighted.w, meta };
}
