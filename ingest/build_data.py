"""Turn the downloaded per-store TSV price files into compact JSON for the web app.

usage: python build_data.py <out_dir>

Reads stores_nearby.json and the TSV files for today from the cache dir (see chains.py) and writes:
  stores.json    list of stores (no exact distances: only a coarse distance band, the repo and site are public)
  prices.json    {"p": {barcode: [agorot per store index or null]}}
  names.json     {barcode: product name}
  weighted.json  {"w": [[ [name, agorot_per_kg], ... ] per store index]}
  meta.json      date, per-store item counts, stores that failed or had no file today
"""
import json, math, sys
from pathlib import Path

from chains import CACHE, TODAY


def is_barcode(code):
    return code.isdigit() and len(code) >= 8


def band(km):
    """Coarse distance label so the published data does not pinpoint the home address."""
    n = math.ceil(km) if km > 0 else 1
    return {1: "עד 1 ק\"מ", 2: "1-2 ק\"מ", 3: "2-3 ק\"מ"}.get(n, "3-4 ק\"מ" if n == 4 else f"עד {n} ק\"מ")


def load_tsv(path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        f = line.split("\t")
        if len(f) < 8:
            continue
        try:
            price = float(f[2])
        except ValueError:
            continue
        rows.append({"code": f[0], "name": f[1], "price": price, "weighted": f[5] == "1"})
    return rows


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    near = json.loads((CACHE / "stores_nearby.json").read_text(encoding="utf-8"))

    stores, tables, missing = [], [], []
    for s in near:
        p = CACHE / f'{s["chain"]}-{s["store_id"]}-{TODAY}.tsv'
        label = f'{s["chain_name"]} {s["name"].replace(s["chain_name"], "").strip()}'.strip()
        if not p.exists():
            missing.append({"key": f'{s["chain"]}:{s["store_id"]}', "name": label, "reason": "no price file today"})
            continue
        rows = load_tsv(p)
        if not rows:
            missing.append({"key": f'{s["chain"]}:{s["store_id"]}', "name": label, "reason": "empty price file"})
            continue
        stores.append({
            "key": f'{s["chain"]}:{s["store_id"]}', "chain": s["chain"], "chainName": s["chain_name"],
            "name": label, "address": f'{s["address"]}, {s["city"]}'.strip(", "),
            "band": band(s["km"]), "approx": bool(s.get("approx_location")), "items": len(rows),
        })
        tables.append(rows)

    if not stores:
        sys.exit("no price files found for today: nothing to build")

    prices, names, weighted = {}, {}, []
    for i, rows in enumerate(tables):
        w = []
        for r in rows:
            cents = int(round(r["price"] * 100))
            if r["weighted"]:
                w.append([r["name"], cents])
            elif is_barcode(r["code"]):
                prices.setdefault(r["code"], [None] * len(stores))[i] = cents
                if len(r["name"]) > len(names.get(r["code"], "")):
                    names[r["code"]] = r["name"]
        weighted.append(w)

    def dump(name, obj):
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    dump("stores.json", stores)
    dump("prices.json", {"p": prices})
    dump("names.json", names)
    dump("weighted.json", {"w": weighted})
    dump("meta.json", {"date": f"{TODAY[:4]}-{TODAY[4:6]}-{TODAY[6:]}", "stores": len(stores), "barcodes": len(prices),
                       "missing": missing})
    print(f"built {len(stores)} stores, {len(prices)} barcodes, {sum(len(w) for w in weighted)} weighted rows; "
          f"{len(missing)} stores had no file -> {out}")
    for m in missing:
        print(f'  skipped {m["key"]} {m["name"]}: {m["reason"]}')


if __name__ == "__main__":
    main()
