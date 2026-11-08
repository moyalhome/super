import { norm } from "./compare";
import type { Item } from "./types";

/** Items that do not fit anywhere. Always shown last, and the hint for "please tag me". */
export const OTHER = "אחר";

/** Default order = a typical walk through the supermarket. The household can reorder it. */
export const DEFAULT_DEPTS = [
  "ירקות ופירות", "לחם ומאפים", "בשר ועוף", "דגים", "חלב וביצים", "קפואים",
  "שימורים ויבשים", "חטיפים ומתוקים", "משקאות", "ניקיון והיגיינה",
];

const PICKLED = /במלח|בחומץ|חמוצ|שימור|מרינד|בשמן/;

// Note: names go through norm() first, which removes quotes and apostrophes ("צ'יפס" becomes "ציפס").
// Short words that also occur inside longer ones ("בקר" in "בקרטון") are matched as whole words.

/** Checked in this order: the first match wins, so the specific groups come before the broad ones. */
const RULES: [string, RegExp][] = [
  ["ניקיון והיגיינה", /(סבון|אקונומיקה|נייר טואלט|שמפו|משחת שיניים|חיתול|אבקת כביסה|כביסה|מרכך|נוזל כלים|מגבונ|טישו|מטליות|שקיות|דאודורנט|מפיות|נייר מגבת|מנקה|ספוג|סכיני גילוח|תחבושת|טמפון|סנו|גאוול|זאוול|קוטל|חרק|פיירי|מבשם|מטהר|טבליות|מסיר)/],
  ["קפואים", /(קפוא|גלידה|גלידת|גלידונית|קורנטו|שלגון|קרטיב|תפוגן)/],
  ["משקאות", /(^|\s)(מים|קולה|קוקה|ספרייט|פנטה|פאנטה|פפסי|מיץ|בירה|יין|סודה|קפה|נסקפה|תה|אייס|משקה|משקאות|וודקה|ויסקי|ערק|ברקן|בקרדי|שוופס|נביעות|נס קפה|פחית|מינרלים|סירופ|תרכיז|קפסולות|אספרסו|נקטר|קרטונית|מונסטר|רד בול)(\s|$)|(שישיי|קרלסברג|הייניקן|גולדסטאר|טובורג|קברנה|מרלו|סוביניון|חליטת|קמומיל|זירו|ספרינג|שתיה|שתייה|מאלט)/],
  ["חטיפים ומתוקים", /(שוקולד|קליק|במבה|ביסלי|עוגיות|עוגייה|סוכריות|סוכריה|גומי|מנטוס|חטיף|פופקורן|וופל|טורטית|מסטיק|ציפס|דוריטוס|ממתק|חלווה|אגוזים|בוטנים|שקדים|גרעינים|פיצוחים|מרשמלו|קרקר|פתי בר|פריכ|בייגלה|טעמי|קרמבו|ערגליות|ציטוס|כאפה|חטיפי|חטיפים)/],
  ["לחם ומאפים", /(לחם|לחמית|פיתה|פיתות|לחמני|חלה|בגט|בורקס|עוגה|עוגת|קרואסון|טורטייה|לאפה|מאפה|רוגלך|בייגל)/],
  ["דגים", /(סלמון|(^|\s)דגים?(\s|$)|נסיכת הנילוס|אמנון|דניס|פילה דג|קרפיון|לברק|הרינג)/],
  ["בשר ועוף", /(^|\s)(חזה עוף|שוק עוף|כנפיים|כנפי עוף|פרגית|פרגיות|שניצל|אנטריקוט|סטייק|צלעות|כבד|המבורגר|קבב|נקניק|נקניקיות|פסטרמה|סלמי|בשר|עוף|הודו|בקר|כבש|סינטה|שייטל)(\s|$)/],
  ["חלב וביצים", /(חלב|קוטג|גבינ|יוגורט|שמנת|חמאה|ביצים|ביצי|לבן(\s|$)|שוקו|מעדן|מילקי|דנונה|אקטימל|קפיר|מוצרלה|פרמזן|עמק|גאודה|בולגרית|צפתית|לבנה|מרגרינה|קרמיסימו|מהדרין|פודינג|דניאלה|סימפוניה|רויון|מוקצף|גב\.|שמ\.)/],
  ["שימורים ויבשים", /(אורז|פסטה|ספגטי|קמח|סוכר|שמן|קטניות|רוטב|תבלין|מלח|עדשים|חומוס|טחינה|קטשופ|מיונז|חרדל|דבש|ריבה|קורנפלקס|דגנים|שיבולת|פתיתים|קוסקוס|אטריות|מרק|אבקת|טונה|זיתים|סילאן|ממרח|קורנפלור|בורגול|גרגירי|פירורי|אפייה|שמרים|קקאו|סולת|גרנולה|אפונה|שעועית|תירס|יכין|ויליפוד|קונפיטור|ריבת|נודלס|מנה חמה|קראנצי)/],
];

const PRODUCE = /^(מלפפון|עגבני|בצל|תפוח אדמה|תפוא|גזר|פלפל|חסה|כרוב|קישוא|חציל|בטטה|לימון|תפוח|בננ|תפוז|אשכולית|אבוקדו|ענבים|אבטיח|מלון|שום|פטרוזיליה|כוסברה|נענע|שמיר|תירס|ברוקולי|כרובית|סלרי|דלעת|פטריות|תמר|רימון|אגס|נקטרינ|שזיף|אפרסק|קלמנטינ|מנדרינ|פומלה|קיווי|מנגו|תות|דובדבן|עירית|סלק|צנון|לפת|קולורבי|ירקות|פירות|אננס|זוקיני|שאלוט|עשבי)/;

/** A suggestion from the product name only. The household can always correct it. */
export function classify(name: string, weighted: boolean): string {
  const n = norm(name);
  if (PICKLED.test(n) && /(מלפפון|עגבני|זית|פלפל|כרוב|לפת|בצל)/.test(n)) return "שימורים ויבשים";
  if (weighted) {
    if (PRODUCE.test(n)) return "ירקות ופירות";
    for (const [dept, rx] of RULES) if (["דגים", "בשר ועוף", "לחם ומאפים"].includes(dept) && rx.test(n)) return dept;
    return OTHER;
  }
  for (const [dept, rx] of RULES) if (rx.test(n)) return dept;
  if (PRODUCE.test(n)) return "ירקות ופירות";
  return OTHER;
}

/** Key under which a correction is remembered for the whole household. */
export function deptKey(it: Pick<Item, "kind" | "barcode" | "keyword" | "text">): string {
  if (it.kind === "barcode") return `dept:b:${it.barcode}`;
  if (it.kind === "weighted") return `dept:w:${norm(it.keyword ?? it.text)}`;
  return `dept:t:${norm(it.text)}`;
}

/** Remembered correction first, then the automatic suggestion. */
export function deptFor(it: Item, kv: Record<string, unknown>): string {
  const remembered = kv[deptKey(it)];
  if (typeof remembered === "string" && remembered) return remembered;
  return it.kind === "weighted" ? classify(it.keyword ?? it.text, true) : classify(it.text, false);
}

/** The household's department order (without "אחר", which is always last). */
export function deptOrder(kv: Record<string, unknown>): string[] {
  const v = kv["deptOrder"];
  const saved = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== OTHER) : [];
  return saved.length ? [...new Set(saved)] : DEFAULT_DEPTS;
}

export function deptOptions(order: string[], current: string): string[] {
  const all = [...order];
  if (current && current !== OTHER && !all.includes(current)) all.push(current);
  return [...all, OTHER];
}

/** Groups items by department in the household's order; unknown departments, then "אחר", come last. */
export function groupByDept(items: Item[], order: string[], getDept: (i: Item) => string): [string, Item[]][] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const d = getDept(it);
    map.set(d, [...(map.get(d) ?? []), it]);
  }
  const known = order.filter((d) => map.has(d));
  const extra = [...map.keys()].filter((d) => !order.includes(d) && d !== OTHER).sort();
  const tail = map.has(OTHER) ? [OTHER] : [];
  return [...known, ...extra, ...tail].map((d) => [d, map.get(d)!]);
}
