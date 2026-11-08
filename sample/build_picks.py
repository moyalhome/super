import json, os, re, sys

cache = sys.argv[1]
out = sys.argv[2]
TODAY = "20261108"
near = {f'{s["chain"]}:{s["store_id"]}': s for s in json.load(open(os.path.join(cache, "stores_nearby.json"), encoding="utf-8"))}

SELECTED = ["shufersal:68", "shufersal:195", "osherad:5", "RamiLevi:727", "TivTaam:94", "doralon:415", "freshmarket:28", "shufersal:180"]


def load(key):
    chain, sid = key.split(":", 1)
    rows = []
    for line in open(os.path.join(cache, f"{chain}-{sid}-{TODAY}.tsv"), encoding="utf-8").read().splitlines():
        f = line.split("\t")
        if len(f) < 8:
            continue
        try:
            rows.append({"code": f[0], "name": f[1], "price": float(f[2]), "weighted": f[5] == "1"})
        except ValueError:
            pass
    return rows


data = {k: load(k) for k in SELECTED}
by_code = {k: {r["code"]: r for r in rows} for k, rows in data.items()}

# kind "barcode": exact product by barcode, qty = units. kind "weighted": price per kg x kg, weighted rows only, cheapest match.
# kind "attrs": any product whose name matches (non weighted), cheapest, qty = units.
ITEMS = [
    ("חלב תנובה 3% 1 ליטר x2", "barcode", "7290004131074", 2),
    ("קוטג' תנובה 3% 250 ג' x2", "barcode", "7290004127077", 2),
    ("אורז בסמטי סוגת 1 ק\"ג", "barcode", "7290003643004", 1),
    ("שמן קנולה 1 ליטר", "barcode", "7290000144474", 1),
    ("פסטה אסם תלתלים 500 ג' x3", "barcode", "7290000060248", 3),
    ("סוכר סוגת 1 ק\"ג", "barcode", "7290003643387", 1),
    ("ביצים L 12 יח' (כל מותג)", "attrs", (r"ביצ.*12|12.*ביצ", r"שליו|שוקולד|עוגי|מטבל|ביצית|חמוצ|אומגה|אורגני|חופש|\bM\b|מדיום|XL|ענק|אקסטרא", r"\bL\b|גדול"), 1),
    ("מלפפון 1 ק\"ג", "weighted", (r"^מלפפון", r"חמוץ|בייבי|מיני|ארוז|שימור|סלט|תאילנדי|חממה"), 1.0),
    ("עגבניה 1 ק\"ג", "weighted", (r"^עגבני(ה|ות)", r"שרי|תמר|מגי|מיובש|קוקטייל|קצוצ|קוביות|מקולפ|מרוס|רסק|שוק|תפוז|שרי|אשכול|חממה"), 1.0),
    ("בננה 1 ק\"ג", "weighted", (r"^בננ(ה|ות)", r"ציפס|צ'יפס|מיובש|חטיף|קפוא"), 1.0),
    ("תפוח אדמה 2 ק\"ג", "weighted", (r"^(תפוח אדמה|תפו\"א|תפוא)", r"קטן|אפיה|לאפיה|אדום|ארוז|בטטה|מתוק|צ'יפס|קפוא|פירה|מוכן|גורמה|ביבי"), 2.0),
    ("חזה עוף טרי 1.5 ק\"ג", "weighted", (r"חזה עוף|פילה עוף", r"קפוא|טחון|שלם|חצוי|שניצל|מפורק|מעושן|מוכן|מתובל|קבב|נקניק|סטייק|שיפוי|שיפוד|פרגית|עם עצם|ברבקיו|פרימה"), 1.5),
    ("בצל יבש 1 ק\"ג", "weighted", (r"^בצל( יבש)?$|^בצל יבש", r"ירוק|סגול|פנינה|מטוגן|מקורמל|קפוא|שימור|אבקת|מוכן|פרוס|חריף|טחון|ארוז"), 1.0),
]

picks = {"stores": [], "items": []}
labels = []
for k in SELECTED:
    s = near[k]
    labels.append(f'{s["chain_name"]} {s["name"].replace(s["chain_name"], "").strip()}'[:60])
picks["stores"] = labels

report = []
for title, kind, spec, qty in ITEMS:
    prices, chosen = [], []
    for k in SELECTED:
        if kind == "barcode":
            r = by_code[k].get(spec)
            prices.append(round(r["price"] * qty, 2) if r else None)
            chosen.append(r["name"] if r else None)
        elif kind == "weighted":
            inc, exc = spec
            hits = sorted((r for r in data[k] if r["weighted"] and re.search(inc, r["name"]) and not re.search(exc, r["name"])), key=lambda r: r["price"])
            r = hits[0] if hits else None
            prices.append(round(r["price"] * qty, 2) if r else None)
            chosen.append(f'{r["name"]} @{r["price"]}/kg' if r else None)
        else:
            inc, exc, need = spec
            hits = sorted((r for r in data[k] if not r["weighted"] and re.search(inc, r["name"]) and re.search(need, r["name"]) and not re.search(exc, r["name"])), key=lambda r: r["price"])
            r = hits[0] if hits else None
            prices.append(round(r["price"] * qty, 2) if r else None)
            chosen.append(r["name"] if r else None)
    picks["items"].append({"item": title, "prices": prices})
    report.append((title, list(zip(SELECTED, chosen, prices))))

json.dump(picks, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for title, rows in report:
    print(f"\n## {title}")
    for k, name, p in rows:
        print(f"  {k:16} {str(p):>7} | {name}")
