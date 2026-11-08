import type { Data, Item } from "./types";

const SB_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const CODE_KEY = "super.code";
const LOCAL_KEY = "super.list";
const LISTS_KEY = "super.lists";
const NAME_KEY = "super.name";
const CLIENT_KEY = "super.client";

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

/** Display name of the person using this device (the household shares one code, so names are self-declared). */
export const getName = () => store.get(NAME_KEY) ?? "";
export const setName = (n: string) => store.set(NAME_KEY, n.trim().slice(0, 40));
/** Identifies this device in the "who is online" list. */
export function clientId(): string {
  let id = store.get(CLIENT_KEY);
  if (!id) { id = uid(); store.set(CLIENT_KEY, id); }
  return id;
}
export const clearCode = () => store.del(CODE_KEY);

export class BadCode extends Error {}
export class Locked extends Error {}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });

/** An item as stored inside a saved list: no id and never "in the cart". */
export type SavedItem = Omit<Item, "id" | "checked" | "addedBy" | "checkedBy" | "createdAt">;
export interface Online { id: string; name: string }
export interface SavedList { id: string; name: string; items: SavedItem[] }

export interface Backend {
  shared: boolean;
  list(): Promise<Item[]>;
  upsert(item: Item): Promise<void>;
  remove(id: string): Promise<void>;
  lists(): Promise<SavedList[]>;
  saveList(name: string, items: SavedItem[]): Promise<void>;
  deleteList(id: string): Promise<void>;
  presence(client: string, name: string): Promise<Online[]>;
  leave(client: string): Promise<void>;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, keepalive = false): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    keepalive,
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  const body = (await r.json()) as unknown;
  // the database answers {"error": "bad_code" | "locked"} instead of raising, so failed attempts can be counted
  const err = body && typeof body === "object" && !Array.isArray(body) ? (body as { error?: string }).error : undefined;
  if (err === "bad_code") throw new BadCode();
  if (err === "locked") throw new Locked();
  if (err) throw new Error(`${fn}: ${err}`);
  return body as T;
}

export function remoteBackend(code: string): Backend {
  return {
    shared: true,
    list: async () => (await rpc<Item[]>("list_get", { p_code: code })) ?? [],
    upsert: async (item) => void (await rpc("item_upsert", { p_code: code, p_item: item })),
    remove: async (id) => void (await rpc("item_delete", { p_code: code, p_id: id })),
    lists: async () => (await rpc<SavedList[]>("saved_lists_get", { p_code: code })) ?? [],
    saveList: async (name, items) => void (await rpc("saved_list_save", { p_code: code, p_name: name, p_items: items })),
    deleteList: async (id) => void (await rpc("saved_list_delete", { p_code: code, p_id: id })),
    presence: async (client, name) => (await rpc<Online[]>("presence_ping", { p_code: code, p_client: client, p_name: name })) ?? [],
    leave: async (client) => void (await rpc("presence_leave", { p_code: code, p_client: client }, true)),
  };
}

/** Used when no database is configured (local preview): the list lives only in this browser. */
export function localBackend(): Backend {
  const read = (): Item[] => { try { return JSON.parse(store.get(LOCAL_KEY) ?? "[]"); } catch { return []; } };
  const write = (l: Item[]) => store.set(LOCAL_KEY, JSON.stringify(l));
  const readLists = (): SavedList[] => { try { return JSON.parse(store.get(LISTS_KEY) ?? "[]"); } catch { return []; } };
  const writeLists = (l: SavedList[]) => store.set(LISTS_KEY, JSON.stringify(l));
  return {
    shared: false,
    list: async () => read(),
    upsert: async (item) => { const l = read().filter((i) => i.id !== item.id); l.push(item); write(l); },
    remove: async (id) => write(read().filter((i) => i.id !== id)),
    lists: async () => readLists(),
    saveList: async (name, items) => {
      const all = readLists();
      const old = all.find((l) => l.name === name);
      writeLists([...all.filter((l) => l.name !== name), { id: old?.id ?? uid(), name, items }]);
    },
    deleteList: async (id) => writeLists(readLists().filter((l) => l.id !== id)),
    presence: async () => [],
    leave: async () => undefined,
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
