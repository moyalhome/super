import glob, json, gzip, re, sys, os
from collections import defaultdict

cache = sys.argv[1]
stores = {}
for p in sorted(glob.glob(os.path.join(cache, "*-2026*.tsv"))):
    key = os.path.basename(p).rsplit("-", 1)[0]
    rows = []
    for line in open(p, encoding="utf-8").read().splitlines():
        f = line.split("\t")
        if len(f) < 8:
            continue
        try:
            price = float(f[2])
        except ValueError:
            continue
        rows.append({"code": f[0], "name": f[1], "price": price, "weighted": f[5] == "1", "unit": f[4], "mfr": f[7]})
    stores[key] = rows

def is_barcode(c):
    return c.isdigit() and len(c) >= 8

print("== per store ==")
for k, rows in stores.items():
    bc = [r for r in rows if is_barcode(r["code"]) and not r["weighted"]]
    w = [r for r in rows if r["weighted"]]
    print(f"{k:18} items={len(rows):6} barcode_nonweighted={len(bc):6} weighted={len(w):5} dup_codes={len(rows)-len({r['code'] for r in rows})}")

bc_sets = {k: {r["code"] for r in rows if is_barcode(r["code"]) and not r["weighted"]} for k, rows in stores.items()}
print("\n== share of store A's barcodes also in store B (rows=A, cols=B, %) ==")
keys = list(stores)
print(" " * 18 + "".join(f"{i:>5}" for i in range(len(keys))))
for i, a in enumerate(keys):
    cells = "".join(f"{(100*len(bc_sets[a] & bc_sets[b])/max(1,len(bc_sets[a]))):5.0f}" for b in keys)
    print(f"{i:2} {a:15}{cells}")

count = defaultdict(int)
for s in bc_sets.values():
    for c in s:
        count[c] += 1
total = len(count)
in2 = sum(1 for v in count.values() if v >= 2)
in_all = sum(1 for v in count.values() if v == len(keys))
print(f"\nunion barcodes={total}  in>=2 stores={in2}  in all {len(keys)}={in_all}")

# estimate the size of a compact prices.json.gz: {barcode: [price per store or null]}
idx = {k: i for i, k in enumerate(keys)}
table = {}
for k, rows in stores.items():
    for r in rows:
        if is_barcode(r["code"]) and not r["weighted"] and count[r["code"]] >= 2:
            table.setdefault(r["code"], [None] * len(keys))[idx[k]] = r["price"]
raw = json.dumps(table, separators=(",", ":")).encode()
print(f"prices table (>=2 stores): {len(table)} barcodes, raw {len(raw)/1e6:.2f} MB, gz {len(gzip.compress(raw))/1e6:.2f} MB")

names = {}
for rows in stores.values():
    for r in rows:
        if is_barcode(r["code"]) and not r["weighted"] and r["code"] not in names:
            names[r["code"]] = r["name"]
nraw = json.dumps(names, ensure_ascii=False, separators=(",", ":")).encode()
print(f"names catalog: {len(names)} barcodes, raw {len(nraw)/1e6:.2f} MB, gz {len(gzip.compress(nraw))/1e6:.2f} MB")

wl = {k: [[r["name"], r["price"]] for r in rows if r["weighted"]] for k, rows in stores.items()}
wraw = json.dumps(wl, ensure_ascii=False, separators=(",", ":")).encode()
print(f"weighted items: {sum(len(v) for v in wl.values())} rows, raw {len(wraw)/1e6:.2f} MB, gz {len(gzip.compress(wraw))/1e6:.2f} MB")

# price spread on a barcode present in all stores: sanity
shared = [c for c, v in count.items() if v == len(keys)]
print("\n== sample of barcodes present in every store (price per store) ==")
lookup = {k: {r["code"]: r for r in rows} for k, rows in stores.items()}
for c in shared[:6]:
    ps = [lookup[k][c]["price"] for k in keys]
    print(c, names.get(c, "")[:30], "min", min(ps), "max", max(ps))
