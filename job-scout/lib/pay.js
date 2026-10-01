// Pay extraction. payMin / payMax are annualized numbers (for charting and sorting);
// payText is the human-readable string shown in the table.

const SYMBOLS = { USD: "$", CAD: "CA$", AUD: "A$", GBP: "£", EUR: "€" };
const HOURS_PER_YEAR = 2080;

function annualize(value, interval = "") {
  if (value == null || Number.isNaN(value)) return null;
  const i = String(interval).toLowerCase();
  if (/hour/.test(i)) return Math.round(value * HOURS_PER_YEAR);
  if (/month/.test(i)) return Math.round(value * 12);
  if (/week/.test(i)) return Math.round(value * 52);
  // Bare numbers under 1,000 are almost always hourly rates.
  if (value < 1000) return Math.round(value * HOURS_PER_YEAR);
  return Math.round(value);
}

const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

export function payFromRange(min, max, currency = "USD", interval = "") {
  const lo = Number(min) || null;
  const hi = Number(max) || lo;
  if (!lo) return { payText: "", payMin: null, payMax: null };
  const sym = SYMBOLS[(currency || "USD").toUpperCase()] ?? `${currency} `;
  const hourly = /hour/i.test(interval) || lo < 1000;
  const unit = hourly ? "/hr" : "";
  const payText = hi && hi !== lo ? `${sym}${hourly ? lo : fmt(lo)} – ${sym}${hourly ? hi : fmt(hi)}${unit}` : `${sym}${hourly ? lo : fmt(lo)}${unit}`;
  return { payText, payMin: annualize(lo, interval), payMax: annualize(hi, interval) };
}

// "$150,000 - $200,000", "$150K–$200K", "USD 120,000 to 140,000", "$45 - $60 per hour", "£60,000 - £70,000"
const NUM = String.raw`(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?`;
const RANGE = new RegExp(
  String.raw`(US\$|CA\$|A\$|\$|£|€|USD\s?|CAD\s?|GBP\s?|EUR\s?)\s?${NUM}\s*(?:-|–|—|to)\s*(?:US\$|CA\$|A\$|\$|£|€|USD\s?|CAD\s?|GBP\s?|EUR\s?)?\s?${NUM}(\s*(?:per|\/|an?)\s*(hour|hr|year|yr|annum|month))?`,
  "i",
);

const toNumber = (digits, k) => {
  const n = Number(digits.replace(/[,.](?=\d{3}\b)/g, ""));
  return k ? n * 1000 : n;
};

export function parsePay(text = "") {
  const m = text.match(RANGE);
  if (!m) return { payText: "", payMin: null, payMax: null };
  const [, , a, ak, b, bk, , unit = ""] = m;
  const lo = toNumber(a, ak);
  const hi = toNumber(b, bk);
  if (!lo || !hi || hi < lo) return { payText: "", payMin: null, payMax: null };
  // Filter out noise like "$5 - $10 million in funding" or tiny numbers that aren't pay.
  if (lo < 10 || hi > 2_000_000) return { payText: "", payMin: null, payMax: null };
  const interval = /hour|hr/i.test(unit) ? "hour" : /month/i.test(unit) ? "month" : "";
  return {
    payText: m[0].replace(/\s+/g, " ").trim(),
    payMin: annualize(lo, interval),
    payMax: annualize(hi, interval),
  };
}
