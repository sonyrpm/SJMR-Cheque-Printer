// Cheque writer engine in plain JavaScript (no Python, no extra program).
// Same rules, same numbers and same PDF bytes as the original Cheque Printer engine:
// pdf_printer.py / cheque_text.py / amount_words.py / data_validation.py.
// Pure functions only: no files, no printer, no books. Printing to Windows is in cheque-engine.mjs.

export const MM_TO_PT = 72.0 / 25.4;
export const SOURCE = "sjmr-cheque-core-1";

// ---- Python-compatible number text -------------------------------------------------------------
// f"{x:.Nf}" in Python rounds the exact binary value half-to-even; toFixed rounds ties up.
export function fixed(value, digits) {
  const x = Number(value);
  if (Object.is(x, -0)) return "-" + (0).toFixed(digits);
  const long = Math.abs(x).toFixed(Math.min(100, digits + 30));
  const point = long.indexOf(".");
  const tail = long.slice(point + 1 + digits);
  let text = Math.abs(x).toFixed(digits);
  if (/^50*$/.test(tail)) {
    // exact tie: keep the even last digit
    const cut = long.slice(0, point + 1 + digits).replace(/\.$/, "");
    const last = Number(cut[cut.length - 1]);
    text = last % 2 === 0 ? cut : text;
  }
  return (x < 0 ? "-" : "") + text;
}
// Python round(x, n): correctly rounded, ties to even.
export function pyRound(value, digits = 0) {
  return Number(fixed(value, digits));
}
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function commas(value, digits) {
  const text = fixed(value, digits);
  const neg = text.startsWith("-");
  const [whole, frac] = text.replace("-", "").split(".");
  return (neg ? "-" : "") + group(whole) + (frac ? "." + frac : "");
}

// ---- Helvetica widths (PDF standard font, never the screen font) ---------------------------------
const HELVETICA = [
  761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761,
  761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 761, 278, 278, 355, 556, 556, 889, 667, 191,
  333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278,
  584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500,
  556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722,
  500, 500, 500, 334, 260, 334, 584, 761, 556, 761, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333,
  1000, 761, 611, 761, 761, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 761, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333,
  333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722,
  667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722,
  722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
const latin1 = (text) => Array.from(String(text), (c) => (c.codePointAt(0) < 256 ? c : "?")).join("");
export function textWidthMm(value, size) {
  let sum = 0;
  for (const ch of latin1(value)) sum += HELVETICA[ch.charCodeAt(0)];
  return ((sum * 0.001 * size) * 25.4) / 72;
}

// ---- Amount in words ----------------------------------------------------------------------------
const ONES_EN = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS_EN = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES_EN = ["", "Thousand", "Million", "Billion", "Trillion"];
export const CURRENCIES = {
  AED: { name: "Dirhams", major: "Dirham", major_pl: "Dirhams", minor: "Fils", minor_pl: "Fils", decimals: 2 },
  USD: { name: "US Dollars", major: "Dollar", major_pl: "Dollars", minor: "Cent", minor_pl: "Cents", decimals: 2 },
  EUR: { name: "Euros", major: "Euro", major_pl: "Euros", minor: "Cent", minor_pl: "Cents", decimals: 2 },
  GBP: { name: "British Pounds", major: "Pound", major_pl: "Pounds", minor: "Pence", minor_pl: "Pence", decimals: 2 },
  SAR: { name: "Saudi Riyals", major: "Riyal", major_pl: "Riyals", minor: "Halala", minor_pl: "Halalas", decimals: 2 },
  QAR: { name: "Qatari Riyals", major: "Riyal", major_pl: "Riyals", minor: "Dirham", minor_pl: "Dirhams", decimals: 2 },
  OMR: { name: "Omani Rials", major: "Rial", major_pl: "Rials", minor: "Baisa", minor_pl: "Baisas", decimals: 3 },
  KWD: { name: "Kuwaiti Dinars", major: "Dinar", major_pl: "Dinars", minor: "Fils", minor_pl: "Fils", decimals: 3 },
  BHD: { name: "Bahraini Dinars", major: "Dinar", major_pl: "Dinars", minor: "Fils", minor_pl: "Fils", decimals: 3 },
  INR: { name: "Indian Rupees", major: "Rupee", major_pl: "Rupees", minor: "Paisa", minor_pl: "Paise", decimals: 2 },
};
function threeDigitsEn(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES_EN[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const ten = TENS_EN[Math.floor(n / 10)],
      one = ONES_EN[n % 10];
    parts.push(one ? `${ten} ${one}` : ten);
  } else if (n > 0) parts.push(ONES_EN[n]);
  return parts.join(" ");
}
function intToWordsEn(value) {
  let n = BigInt(value);
  if (n === 0n) return "Zero";
  if (n < 0n) return "Minus " + intToWordsEn(-n);
  const parts = [];
  let scale = 0;
  while (n > 0n) {
    const chunk = Number(n % 1000n);
    if (chunk > 0) parts.push(`${threeDigitsEn(chunk)} ${SCALES_EN[scale]}`.trim());
    n /= 1000n;
    scale += 1;
  }
  return parts.reverse().join(" ");
}
const ONES_AR = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS_AR = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS_AR = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
function threeDigitsAr(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(HUNDREDS_AR[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 20) {
    const one = n % 10,
      ten = Math.floor(n / 10);
    parts.push(one > 0 ? `${ONES_AR[one]} و${TENS_AR[ten]}` : TENS_AR[ten]);
  } else if (n > 0) parts.push(ONES_AR[n]);
  return parts.join(" و");
}
function intToWordsAr(value) {
  let n = BigInt(value);
  if (n === 0n) return "صفر";
  if (n < 0n) return "ناقص " + intToWordsAr(-n);
  const parts = [];
  const billions = n / 1000000000n;
  n %= 1000000000n;
  if (billions) {
    if (billions === 1n) parts.push("مليار");
    else if (billions === 2n) parts.push("ملياران");
    else parts.push(`${intToWordsAr(billions)} مليار`);
  }
  const millions = Number((n / 1000000n) % 1000n),
    thousands = Number((n / 1000n) % 1000n),
    remainder = Number(n % 1000n);
  if (millions > 0) {
    if (millions === 1) parts.push("مليون");
    else if (millions === 2) parts.push("مليونان");
    else if (millions >= 3 && millions <= 10) parts.push(`${threeDigitsAr(millions)} ملايين`);
    else parts.push(`${threeDigitsAr(millions)} مليوناً`);
  }
  if (thousands > 0) {
    if (thousands === 1) parts.push("ألف");
    else if (thousands === 2) parts.push("ألفان");
    else if (thousands >= 3 && thousands <= 10) parts.push(`${threeDigitsAr(thousands)} آلاف`);
    else parts.push(`${threeDigitsAr(thousands)} ألفاً`);
  }
  if (remainder > 0) parts.push(threeDigitsAr(remainder));
  return parts.join(" و");
}
const AR_LABELS = {
  AED: ["درهماً", "فلساً"], USD: ["دولاراً أمريكياً", "سنتاً"], EUR: ["يورو", "سنتاً"], GBP: ["جنيهاً إسترلينياً", "بنساً"],
  SAR: ["ريالاً سعودياً", "هللة"], QAR: ["ريالاً قطرياً", "درهماً"], OMR: ["ريالاً عمانياً", "بيسة"],
  KWD: ["ديناراً كويتياً", "فلساً"], BHD: ["ديناراً بحرينياً", "فلساً"], INR: ["روبية هندية", "بيسة"],
};

// Decimal text helpers (no floating point for money).
function parseDecimal(text) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(text).replace(/,/g, "").trim());
  if (!m || (!m[2] && !m[3])) return null;
  return { neg: m[1] === "-", whole: BigInt(m[2] || "0"), frac: m[3] || "" };
}
// Round half up to `places` decimals. Returns { neg, whole, minor } with minor a BigInt of `places` digits.
function quantizeHalfUp(dec, places) {
  const frac = dec.frac.padEnd(places + 1, "0");
  let minor = BigInt(frac.slice(0, places) || "0");
  let whole = dec.whole;
  if (Number(frac[places] || "0") >= 5) minor += 1n;
  const base = 10n ** BigInt(places);
  if (minor >= base) {
    minor -= base;
    whole += 1n;
  }
  return { whole, minor };
}
export function amountToWords(amount, currency = "AED", style = "standard", language = "EN") {
  const dec = parseDecimal(amount);
  if (!dec) return "";
  if (dec.whole >= 1000000000000000n) return "";
  const code = String(currency).toUpperCase();
  const info = CURRENCIES[code] || CURRENCIES.AED;
  const places = info.decimals;
  const { whole, minor } = quantizeHalfUp(dec, places);
  const minorText = String(minor).padStart(places, "0");
  const factor = 10 ** places;
  if (String(language).toUpperCase() === "AR") {
    const [majorLabel, minorLabel] = AR_LABELS[code] || ["درهماً", "فلساً"];
    const majorAr = intToWordsAr(whole);
    if (minor > 0n) return `فقط ${majorAr} ${majorLabel} و ${minorText} ${minorLabel} لا غير`;
    return `فقط ${majorAr} ${majorLabel} لا غير`;
  }
  const majorWords = intToWordsEn(whole);
  const minorName = minor === 1n ? info.minor : info.minor_pl;
  const prefix = style === "with_currency" ? `${info.name} ` : "";
  if (minor > 0n) {
    if (style === "spelled_fils") return `${prefix}${majorWords} and ${intToWordsEn(minor)} ${minorName} Only`;
    return `${prefix}${majorWords} and ${minorName} ${minorText}/${factor} Only`;
  }
  if (style === "with_currency") return `${prefix}${majorWords} Only`;
  return `${majorWords} Only`;
}
export function splitWordsTwoLines(words, maxCharsLine1 = 46) {
  words = String(words || "").trim();
  const maxC = Math.max(15, Math.trunc(Number(maxCharsLine1) || 46));
  if (Array.from(words).length <= maxC) return [words, ""];
  const tokens = words.replace(/-/g, " ").split(" ").filter(Boolean);
  const line1 = [],
    line2 = [];
  let len = 0,
    onLine2 = false;
  for (const tok of tokens) {
    const add = tok.length + (line1.length ? 1 : 0);
    if (!onLine2 && len + add <= maxC) {
      line1.push(tok);
      len += add;
    } else {
      onLine2 = true;
      line2.push(tok);
    }
  }
  if (!line1.length && line2.length) line1.push(line2.shift());
  return [line1.join(" "), line2.join(" ")];
}

// ---- Text options -------------------------------------------------------------------------------
export const TEXT_DEFAULTS = {
  payee_prefix: "", payee_suffix: "", long_payee: "keep", amount_prefix: "**", amount_suffix: "**",
  no_trailing_zeros: true, words_prefix: "**", words_suffix: "**", words_caps: true,
};
const LONG_PAYEE = ["keep", "wrap", "shrink"];
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function validateOptions(value) {
  if (value === undefined || value === null) return { ...TEXT_DEFAULTS };
  if (!isObject(value) || Object.keys(value).some((k) => !Object.hasOwn(TEXT_DEFAULTS, k)))
    throw new Error("Invalid cheque text options.");
  const result = { ...TEXT_DEFAULTS, ...value };
  for (const key of ["payee_prefix", "payee_suffix", "amount_prefix", "amount_suffix", "words_prefix", "words_suffix"]) {
    const text = result[key];
    if (typeof text !== "string" || Array.from(text).length > 80 || Array.from(text).some((c) => c.codePointAt(0) < 32))
      throw new Error("Prefixes and suffixes allow 80 printable characters.");
  }
  if (!LONG_PAYEE.includes(result.long_payee) || typeof result.no_trailing_zeros !== "boolean" || typeof result.words_caps !== "boolean")
    throw new Error("Choose valid text formatting options.");
  return result;
}
export function accountOptions(account, templateId) {
  if (account.CCAC_TEXT_OPTIONS !== undefined && account.CCAC_TEXT_OPTIONS !== null)
    return validateOptions(account.CCAC_TEXT_OPTIONS);
  const saved = JSON.parse(account.CCAC_FIELD_LAYOUT || "{}");
  return validateOptions(saved?.[templateId]?.text_options);
}
export function amountText(amount, options) {
  const whole = Math.abs(amount - pyRoundInt(amount)) < 1e-6;
  const body = options.no_trailing_zeros && whole ? commas(pyRoundInt(amount), 0) : commas(amount, 2);
  return options.amount_prefix + body + options.amount_suffix;
}
function pyRoundInt(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
export function payeeTextLines(payee, options, widthMm, fontPt) {
  const text = options.payee_prefix + payee + options.payee_suffix;
  if (options.long_payee === "keep") return [[text, fontPt]];
  if (widthMm <= 0) throw new Error("Set a positive payee field width.");
  const measured = textWidthMm(text, fontPt);
  if (options.long_payee === "shrink")
    return [[text, measured ? Math.max(6, Math.min(fontPt, (fontPt * widthMm) / measured)) : fontPt]];
  if (measured <= widthMm) return [[text, fontPt]];
  const chars = Array.from(text);
  let cut = 1;
  for (let index = 1; index < chars.length; index++) {
    if (textWidthMm(chars.slice(0, index).join(""), fontPt) > widthMm) break;
    cut = index;
  }
  const space = chars.slice(0, cut + 1).join("").lastIndexOf(" ");
  const spaceAt = space > 0 ? Array.from(chars.slice(0, cut + 1).join("").slice(0, space)).length : -1;
  if (spaceAt > 0) cut = spaceAt;
  return [
    [chars.slice(0, cut).join("").trimEnd(), fontPt],
    [chars.slice(cut).join("").trimStart(), fontPt],
  ];
}

// ---- Validation ---------------------------------------------------------------------------------
const MAX_AMOUNT = 999999999999999n; // 999,999,999,999.999 as thousandths
export function money(value, currency = "AED", positive = true) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (!Object.hasOwn(CURRENCIES, code)) throw new Error("Select a supported currency.");
  const text = String(value).trim();
  if (text.includes(",") && !/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text))
    throw new Error("Use a valid amount, for example 1,234.50.");
  const dec = parseDecimal(text);
  if (!dec) throw new Error("Enter a valid numeric amount.");
  const milli = BigInt((dec.whole.toString() + (dec.frac + "000").slice(0, 3)) || "0");
  if (dec.whole > 999999999999n || milli > MAX_AMOUNT)
    throw new Error("Amount must be finite and no greater than 999,999,999,999.999.");
  const zero = dec.whole === 0n && /^0*$/.test(dec.frac);
  const negative = dec.neg && !zero;
  if ((positive && (zero || negative)) || (!positive && negative))
    throw new Error(positive ? "Amount must be greater than zero." : "Amount cannot be negative.");
  const places = CURRENCIES[code].decimals;
  if (!/^0*$/.test(dec.frac.slice(places)))
    throw new Error(`${code} allows at most ${places} decimal places. Correct the amount before saving.`);
  const frac = dec.frac.slice(0, places).padEnd(places, "0");
  return (negative ? "-" : "") + dec.whole.toString() + (places ? "." + frac : "");
}
export function isoDate(value, optional = false) {
  if (optional && !value) return null;
  const text = String(value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const ok = m && (() => {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number(m[1]) >= 1 && d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
  })();
  if (!ok) throw new Error("Enter a valid date in YYYY-MM-DD format, or select Blank Date.");
  return text;
}

// ---- Cheque background photo (preview only) -----------------------------------------------------
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
function imageSize(raw) {
  if (raw.length > 24 && raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (raw.subarray(12, 16).toString("latin1") !== "IHDR" || raw.indexOf(Buffer.from("IEND")) < 0) return null;
    return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
  }
  if (raw.length > 4 && raw[0] === 0xff && raw[1] === 0xd8) {
    let i = 2;
    while (i + 9 < raw.length) {
      if (raw[i] !== 0xff) return null;
      const marker = raw[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: raw.readUInt16BE(i + 7), height: raw.readUInt16BE(i + 5) };
      i += 2 + raw.readUInt16BE(i + 2);
    }
  }
  return null;
}
export function checkImage(raw) {
  if (raw.length > MAX_FILE_BYTES) throw new Error("Choose a cheque image smaller than 10 MB.");
  const size = imageSize(raw);
  if (!size || !size.width || !size.height) throw new Error("Cannot read this cheque image. Use a valid PNG or JPEG.");
  if (size.width * size.height > MAX_PIXELS) throw new Error("Image is too large. Use at most 16 megapixels.");
  return size;
}
function strictBase64(text) {
  if (typeof text !== "string" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error("Invalid cheque background image data.");
  return Buffer.from(text, "base64");
}
export function loadBackground(base64) {
  const raw = strictBase64(base64);
  const size = checkImage(raw);
  if (raw.subarray(0, 4).toString("latin1") !== "\x89PNG")
    throw new Error("Open the photo in the cheque screen so it is converted to PNG first.");
  return { background: { format: "png", data: raw.toString("base64") }, width: size.width, height: size.height };
}
export function decodeBackground(value) {
  if (!isObject(value) || value.format !== "png" || typeof value.data !== "string")
    throw new Error("Invalid cheque background image.");
  if (value.data.length > Math.floor((MAX_FILE_BYTES * 4) / 3) + 4)
    throw new Error("Cheque background image is too large.");
  checkImage(strictBase64(value.data));
  return value;
}

// ---- Layouts ------------------------------------------------------------------------------------
export function validateLayouts(data) {
  if (!isObject(data) || !Object.keys(data).length || Object.keys(data).length > 500)
    throw new Error("Layout file must contain between 1 and 500 bank layouts.");
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key))
      throw new Error("Layout IDs use letters, digits, underscores and hyphens (maximum 80 characters).");
    if (!isObject(value)) throw new Error(`Invalid layout: ${key}.`);
    const item = JSON.parse(JSON.stringify(value));
    if ((item.id ?? key) !== key) throw new Error(`Layout ID does not match its key: ${key}.`);
    item.id = key;
    const label = item.display_name ?? key;
    if (typeof label !== "string" || !label.trim() || Array.from(label).length > 150)
      throw new Error(`Enter a bank name for layout ${key} (maximum 150 characters).`);
    item.display_name = label.trim();
    const fields = item.fields;
    if (!isObject(fields) || !["mmPayee", "mmAmount", "mmAmountText1", "mmAmountText2"].every((k) => Object.hasOwn(fields, k)) || Object.keys(fields).length > 200)
      throw new Error(`Layout ${key} needs payee, amount and two amount-in-words fields.`);
    for (const [name, field] of Object.entries(fields)) {
      if (!isObject(field)) throw new Error(`Invalid field in layout ${key}.`);
      for (const prop of ["left_mm", "top_mm", "width_mm", "height_mm"]) {
        if (!Object.hasOwn(field, prop)) {
          if (prop === "left_mm" || prop === "top_mm") throw new Error(`Missing ${prop} in ${key}/${name}.`);
          continue;
        }
        const n = field[prop];
        if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1000)
          throw new Error(`Invalid ${prop} in ${key}/${name}; use a finite measurement within ±1000 mm.`);
      }
    }
    if (item.background_image !== undefined && item.background_image !== null) decodeBackground(item.background_image);
    result[key] = item;
  }
  return result;
}

// ---- Drawing surfaces ---------------------------------------------------------------------------
function pdfEscape(text) {
  if (!text) return "";
  return latin1(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
export class PdfCanvas {
  constructor(widthMm = 297, heightMm = 210) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    this.widthPt = widthMm * MM_TO_PT;
    this.heightPt = heightMm * MM_TO_PT;
    this.ops = [];
  }
  y(top) { return (this.heightMm - top) * MM_TO_PT; }
  x(left) { return left * MM_TO_PT; }
  set_stroke_color(r, g, b) { this.ops.push(`${fixed(r, 3)} ${fixed(g, 3)} ${fixed(b, 3)} RG`); }
  set_fill_color(r, g, b) { this.ops.push(`${fixed(r, 3)} ${fixed(g, 3)} ${fixed(b, 3)} rg`); }
  set_line_width(w) { this.ops.push(`${fixed(w, 2)} w`); }
  draw_line(x1, y1, x2, y2) {
    this.ops.push(`${fixed(this.x(x1), 2)} ${fixed(this.y(y1), 2)} m ${fixed(this.x(x2), 2)} ${fixed(this.y(y2), 2)} l S`);
  }
  draw_rect(left, top, width, height, fill = false, stroke = true) {
    const op = fill && stroke ? "B" : fill ? "f" : "S";
    this.ops.push(`${fixed(this.x(left), 2)} ${fixed(this.y(top + height), 2)} ${fixed(width * MM_TO_PT, 2)} ${fixed(height * MM_TO_PT, 2)} re ${op}`);
  }
  draw_text(left, top, text, font = "F1", size = 10, rotation = 0) {
    if (!text) return;
    const escaped = pdfEscape(text);
    const x = this.x(left),
      y = this.y(top + size * 0.31);
    if (Math.abs(rotation) < 0.01) {
      this.ops.push(`BT /${font} ${fixed(size, 1)} Tf ${fixed(x, 2)} ${fixed(y, 2)} Td (${escaped}) Tj ET`);
    } else {
      const rad = (rotation * Math.PI) / 180;
      const c = Math.cos(rad),
        s = Math.sin(rad);
      this.ops.push(`BT /${font} ${fixed(size, 1)} Tf ${fixed(c, 4)} ${fixed(s, 4)} ${fixed(-s, 4)} ${fixed(c, 4)} ${fixed(x, 2)} ${fixed(y, 2)} Tm (${escaped}) Tj ET`);
    }
  }
  toBuffer() {
    const stream = Buffer.from(this.ops.join("\n"), "latin1");
    const objects = [
      Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "latin1"),
      Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "latin1"),
      Buffer.from(
        `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(this.widthPt, 2)} ${fixed(this.heightPt, 2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>\nendobj\n`,
        "latin1",
      ),
      Buffer.from("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n", "latin1"),
      Buffer.from("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n", "latin1"),
      Buffer.from("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj\n", "latin1"),
      Buffer.concat([Buffer.from(`7 0 obj\n<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream\nendobj\n", "latin1")]),
    ];
    const parts = [Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let size = parts[0].length;
    const offsets = [];
    for (const obj of objects) {
      offsets.push(size);
      parts.push(obj);
      size += obj.length;
    }
    let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) tail += `${String(off).padStart(10, "0")} 00000 n \n`;
    tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
    parts.push(Buffer.from(tail, "latin1"));
    return Buffer.concat(parts);
  }
}

// Records what to draw (for the on-screen preview, drawn by the browser).
export class SceneCanvas {
  constructor(widthMm, heightMm) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    this.items = [];
    this.fill = [0, 0, 0];
    this.stroke = [0, 0, 0];
    this.lineWidth = 1;
  }
  set_stroke_color(r, g, b) { this.stroke = [r, g, b]; }
  set_fill_color(r, g, b) { this.fill = [r, g, b]; }
  set_line_width(w) { this.lineWidth = w; }
  draw_line(x1, y1, x2, y2) { this.items.push({ k: "line", x1, y1, x2, y2, w: this.lineWidth, c: [...this.stroke] }); }
  draw_rect(left, top, width, height, fill = false, stroke = true) {
    this.items.push({ k: "rect", x: left, y: top, w: width, h: height, fill: fill ? [...this.fill] : null, stroke: stroke ? [...this.stroke] : null, lw: this.lineWidth });
  }
  draw_text(left, top, text, font = "F1", size = 10, rotation = 0) {
    if (!text) return;
    this.items.push({ k: "text", x: left, y: top, text: String(text), font, size, rot: rotation, c: [...this.fill] });
  }
}

// Plain list of lines and texts for the Windows direct-print helper.
export class DirectCollector {
  constructor() {
    this.lines = [];
    this.texts = [];
    this.lineWidthPt = 0.95;
  }
  set_fill_color() {}
  set_stroke_color() {}
  set_line_width(w) { this.lineWidthPt = w; }
  draw_line(x1, y1, x2, y2) {
    this.lines.push({ x1_mm: pyRound(x1, 2), y1_mm: pyRound(y1, 2), x2_mm: pyRound(x2, 2), y2_mm: pyRound(y2, 2), width_pt: pyRound(this.lineWidthPt, 2) });
  }
  draw_text(left, top, text, font = "F1", size = 12.5, rotation = 0) {
    if (!text) return;
    this.texts.push({ x_mm: pyRound(left, 2), y_mm: pyRound(top, 2), text: String(text), font_pt: pyRound(size, 2), rotation_deg: pyRound(rotation, 2), bold: font === "F2" });
  }
}

// ---- Cheque drawing -----------------------------------------------------------------------------
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const stripStars = (s) => s.replace(/^\*+/, "").replace(/\*+$/, "");
const pad2 = (n) => String(n).padStart(2, "0");
function parseDate(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(text).slice(0, 10));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { dd: pad2(d), mm: pad2(mo), yyyy: String(y).padStart(4, "0") };
}
export function chequeLeafDimensions(template) {
  const fields = template.fields || {};
  let maxX = 152,
    maxY = 60;
  for (const [k, v] of Object.entries(fields)) {
    if (k === "mmBank") continue;
    const r = num(v.left_mm ?? 0) + Math.min(num(v.width_mm ?? 20), 40);
    const b = num(v.top_mm ?? 0) + num(v.height_mm ?? 6);
    if (r > maxX) maxX = r;
    if (b > maxY) maxY = b;
  }
  const width = Math.max(164, pyRound(maxX + 12, 1));
  return [width, Math.max(82, pyRound(width / 2, 1))];
}
export function resolveChequeDimensions(template, account) {
  const [rawW, rawH] = chequeLeafDimensions(template);
  const w = num(account.CCAC_CHEQUE_WIDTH) || 0;
  const h = num(account.CCAC_CHEQUE_HEIGHT) || 0;
  return [w > 40 ? w : rawW, h > 25 ? h : rawH];
}

export function renderChequeFields(canvas, template, data, ox = 0, oy = 0, shiftAc = 0, fontSizePt = 12.5, scalePct = 100, wrapChars = 40, lineSpacing = 0, textOptions = null) {
  const options = validateOptions(textOptions);
  const fields = template.fields || {};
  const ls = num(lineSpacing || 0);
  const sf = Math.max(0.5, num(scalePct || 100) / 100);
  const fPt = Math.max(6, num(fontSizePt || 12.5));
  const wordsPt = Math.max(6, fPt - 0.5);
  const acPt = Math.max(6, pyRound(fPt * 0.78, 1));
  const maxWrap = Math.max(15, Math.trunc(num(wrapChars || 40)));

  canvas.set_fill_color(0, 0, 0);
  canvas.set_stroke_color(0, 0, 0);
  canvas.set_line_width(0.95);

  const crossing = Math.trunc(num(data.CCT_CROSSING_OPTION ?? 1, 1));
  const acPayee = (data.CCT_AC_PAYEE_ONLY ?? "Y") === "Y";
  if (acPayee && crossing > 0) {
    const stamp = { 1: "A/C PAYEE ONLY", 2: "NOT NEGOTIABLE", 3: "A/C PAYEE ONLY" }[crossing] || "A/C PAYEE ONLY";
    const ln1 = fields.lnPayee1 || { left_mm: -0.5, top_mm: 18.9, width_mm: 28, height_mm: -20 };
    const ln2 = fields.lnPayee2 || { left_mm: -0.3, top_mm: 26.1, width_mm: 39, height_mm: -28 };
    const x1s = Math.max(0, num(ln1.left_mm) * sf) + ox + shiftAc;
    const y1s = num(ln1.top_mm) * sf + oy;
    const x1e = (num(ln1.left_mm) + num(ln1.width_mm)) * sf + ox + shiftAc;
    const y1e = Math.max(0, (num(ln1.top_mm) + num(ln1.height_mm)) * sf) + oy;
    const x2s = Math.max(0, num(ln2.left_mm) * sf) + ox + shiftAc;
    const y2s = num(ln2.top_mm) * sf + oy;
    const x2e = (num(ln2.left_mm) + num(ln2.width_mm)) * sf + ox + shiftAc;
    const y2e = Math.max(0, (num(ln2.top_mm) + num(ln2.height_mm)) * sf) + oy;
    canvas.draw_line(x1s, y1s, x1e, y1e);
    canvas.draw_line(x2s, y2s, x2e, y2e);
    const dx = x2e - x2s,
      dy = y2s - y2e;
    const angle = dx > 0 ? (Math.atan2(dy, dx) * 180) / Math.PI : 35;
    canvas.draw_text(x1s + 6 * sf, (y1s + y2s) / 2 - 4.4 * sf, stamp, "F1", acPt, angle);
  }

  const payee = stripStars(String(data.CCT_PAYEE || "").trim());
  if (payee) {
    const f = fields.mmPayee || { left_mm: 32, top_mm: 26.5 };
    payeeTextLines(payee, options, num(f.width_mm ?? 133) * sf, fPt).forEach(([line, size], index) => {
      canvas.draw_text(num(f.left_mm) * sf + ox, num(f.top_mm) * sf + oy + index * ((fPt * 1.2) / MM_TO_PT), line, "F1", size);
    });
  }

  const dateText = String(data.CCT_DATE || "").trim();
  if (dateText) {
    const dt = parseDate(dateText);
    if (dt) {
      if (fields.mmD1 && fields.mmD2) {
        const spacing = Math.abs(num(fields.mmD2.left_mm) - num(fields.mmD1.left_mm));
        if (spacing <= 2.6 || fields.mmS1) {
          const f = fields.mmD1;
          canvas.draw_text(num(f.left_mm) * sf + ox, num(f.top_mm) * sf + oy, `${dt.dd}/${dt.mm}/${dt.yyyy}`, "F1", fPt);
        } else {
          const boxes = (keys) => keys.filter((k) => fields[k]).map((k) => fields[k]).sort((a, b) => a.left_mm - b.left_mm);
          const put = (list, text) =>
            list.forEach((box, i) => {
              if (i < text.length) canvas.draw_text(box.left_mm * sf + ox, box.top_mm * sf + oy, text[i], "F1", fPt);
            });
          put(boxes(["mmD1", "mmD2"]), dt.dd);
          put(boxes(["mmM1", "mmM2"]), dt.mm);
          put(boxes(["mmY1", "mmY2", "mmY3", "mmY4"]), dt.yyyy);
        }
      } else {
        const f = fields.mmDate || { left_mm: 124, top_mm: 20 };
        canvas.draw_text(num(f.left_mm) * sf + ox, num(f.top_mm) * sf + oy, `${dt.dd}/${dt.mm}/${dt.yyyy}`, "F1", fPt);
      }
    }
  }

  const amount = num(data.CCT_AMOUNT || 0);
  if (amount > 0) {
    const f = fields.mmAmount || { left_mm: 122, top_mm: 45.5 };
    canvas.draw_text(num(f.left_mm) * sf + ox, num(f.top_mm) * sf + oy, amountText(amount, options), "F1", fPt);
  }

  let wording = stripStars(String(data.CCT_WORDING || "").trim());
  if (options.words_caps) wording = wording.toUpperCase();
  if (wording) {
    const [line1, line2] = splitWordsTwoLines(wording, maxWrap);
    const f1 = fields.mmAmountText1 || { left_mm: 13, top_mm: 36.8 };
    canvas.draw_text(num(f1.left_mm) * sf + ox, num(f1.top_mm) * sf + oy + ls, options.words_prefix + line1 + (line2 ? "" : options.words_suffix), "F1", wordsPt);
    if (line2) {
      const f2 = fields.mmAmountText2 || { left_mm: 4, top_mm: 44.5 };
      canvas.draw_text(num(f2.left_mm) * sf + ox, num(f2.top_mm) * sf + oy + 2 * ls, line2 + options.words_suffix, "F1", wordsPt);
    }
  }

  if ((data.CCT_NO_BEARER ?? "Y") === "Y") {
    const fp = fields.mmPayee || { left_mm: 32, top_mm: 26.5 };
    const fn = fields.mmNoBearer || { left_mm: 8, top_mm: fp.top_mm + 1.2 };
    let nx = num(fn.left_mm),
      ny = num(fn.top_mm);
    if (nx < 4.5) {
      nx = 8;
      ny = num(fp.top_mm) + 1.2;
    }
    canvas.draw_text(nx * sf + ox, ny * sf + oy, "XXXXXX", "F1", fPt);
  }
}

function accountNumbers(account) {
  return {
    ox: num(account.CCAC_PRINTER_OFFSET_X || 0),
    oy: num(account.CCAC_PRINTER_OFFSET_Y || 0),
    shift: num(account.CCAC_SHIFT_AC_PAYEE || 0),
    font: num(account.CCAC_FONT_SIZE || 12.5),
    scale: num(account.CCAC_SCALE_PCT || 100),
    wrap: Math.trunc(num(account.CCAC_WRAP_CHARS || 40)),
    spacing: num(account.CCAC_LINE_SPACING || 0),
  };
}
function leafSize(template, account) {
  const [rawW, rawH] = resolveChequeDimensions(template, account);
  const sf = Math.max(0.5, accountNumbers(account).scale / 100);
  return [pyRound(rawW * sf, 1), pyRound(rawH * sf, 1)];
}
function drawLeaf(canvas, template, data, account, baseX = 0, baseY = 0) {
  const a = accountNumbers(account);
  renderChequeFields(canvas, template, data, baseX + a.ox, baseY + a.oy, a.shift, a.font, a.scale, a.wrap, a.spacing, accountOptions(account, template.id));
}
export function chequePdf(template, data, account) {
  const [w, h] = leafSize(template, account);
  const canvas = new PdfCanvas(w, h);
  drawLeaf(canvas, template, data, account);
  return canvas.toBuffer();
}

// What ChequeDirectPrinter prints: placement on the A4 sheet depends on the feed mode.
export function directJob(template, data, account, mode, orientation) {
  const [w, h] = leafSize(template, account);
  const landscape = String(orientation || "Landscape").toLowerCase() !== "portrait";
  const pageW = landscape ? 297 : 210,
    pageH = landscape ? 210 : 297;
  let baseX = 0,
    baseY = 0;
  if (mode === "a4_center_tray") {
    baseX = Math.max(0, pageW - w);
    baseY = Math.max(0, (pageH - h) / 2);
  } else if (mode === "a4_left_center_tray") {
    baseY = Math.max(0, (pageH - h) / 2);
  }
  const collector = new DirectCollector();
  drawLeaf(collector, template, data, account, baseX, baseY);
  return collector;
}

// ---- Preview (the browser draws it; hit regions come from the same numbers) ---------------------
// pdfium measured the drawn glyphs: about 0.72 em above the baseline (capitals) and a little below.
const ASCENT = 0.72,
  DESCENT = 0.1;
function guideScene(template, data, account, width, height, follow) {
  const canvas = new SceneCanvas(width, height);
  const fields = template.fields || {};
  const a = accountNumbers(account);
  const sf = Math.max(0.5, a.scale / 100);
  const ox = follow ? a.ox : 0,
    oy = follow ? a.oy : 0,
    ls = follow ? a.spacing : 0;
  canvas.set_fill_color(0.98, 0.985, 0.995);
  canvas.draw_rect(0, 0, width, height, true, false);
  canvas.set_stroke_color(0.88, 0.95, 0.99);
  canvas.set_line_width(0.3);
  for (let y = 12; y < Math.max(12, Math.trunc(height - 15)); y += 5) canvas.draw_line(2, y, width - 2, y);
  canvas.set_fill_color(1, 1, 1);
  canvas.set_stroke_color(0.8, 0.84, 0.88);
  canvas.draw_rect(0, height - 14, width, 14, true);
  canvas.set_fill_color(0.06, 0.09, 0.16);
  canvas.draw_text(44, 5, String(template.display_name ?? template.id ?? "Bank").toUpperCase(), "F2", 10.5);
  canvas.set_fill_color(0.28, 0.33, 0.41);
  canvas.draw_text(44, 12, `Account: ${account.CCAC_NO ?? ""}  |  ${account.CCAC_NAME ?? ""}`, "F1", 7);
  for (const [key, def, end, spacing] of [
    ["mmPayee", [32, 26.6], 18, 0],
    ["mmAmountText1", [13, 36.8], 38, ls],
    ["mmAmountText2", [4, 44.5], 46, 2 * ls],
  ]) {
    const field = fields[key] || { left_mm: def[0], top_mm: def[1] };
    const x = field.left_mm * sf + ox,
      y = field.top_mm * sf + oy + spacing;
    canvas.set_stroke_color(0.73, 0.79, 0.85);
    canvas.draw_line(x, y + 5.2, width - end + ox, y + 5.2);
    if ((key === "mmPayee" && (data.CCT_NO_BEARER ?? "N") !== "Y") || key === "mmAmountText1") {
      canvas.set_fill_color(0.39, 0.45, 0.55);
      canvas.draw_text(6 + ox, y + 1, key === "mmPayee" ? "Pay:" : "Sum:", "F1", 6);
    }
  }
  const amt = fields.mmAmount || { left_mm: 122, top_mm: 45.5 };
  const ax = amt.left_mm * sf + ox,
    ay = amt.top_mm * sf + oy;
  canvas.set_fill_color(1, 1, 1);
  canvas.set_stroke_color(0.01, 0.52, 0.78);
  canvas.set_line_width(0.7);
  canvas.draw_rect(ax - 3, ay - 1, 38, 7.5, true);
  canvas.set_fill_color(0.06, 0.09, 0.16);
  canvas.draw_text(ax - 13, ay + 1, data.CCT_CURRENCY || "AED", "F2", 8);
  const slash = fields.mmS1 || (fields.mmD1 && fields.mmD2 && Math.abs(fields.mmD2.left_mm - fields.mmD1.left_mm) <= 2.6);
  if (!slash) {
    canvas.set_stroke_color(0.39, 0.45, 0.55);
    for (const key of ["mmD1", "mmD2", "mmM1", "mmM2", "mmY1", "mmY2", "mmY3", "mmY4"])
      if (fields[key]) canvas.draw_rect(fields[key].left_mm * sf + ox, fields[key].top_mm * sf + oy, 4.2, 5.8);
  }
  const number = String(data.CCT_CHEQUE_NO || "100001").padStart(6, "0");
  const digits = String(account.CCAC_NO || "1234567890").replace(/\D/g, "").slice(-10).padStart(10, "0");
  canvas.set_fill_color(0.12, 0.16, 0.23);
  canvas.draw_text(Math.max(4, width / 2 - 40), height - 10, `C ${number} C    A 033000101 A    ${digits} C`, "F3", 8);
  return canvas.items;
}
export function chequePreview(template, data, account, followGuides = true) {
  const [width, height] = leafSize(template, account);
  if (![width, height].every((v) => Number.isFinite(v) && v > 0 && v <= 1000))
    throw new Error("Invalid cheque dimensions for preview.");
  const a = accountNumbers(account);
  const options = accountOptions(account, template.id);
  const printed = new SceneCanvas(width, height);
  drawLeaf(printed, template, data, account);
  const sf = Math.max(0.5, a.scale / 100);
  const regions = {};
  const texts = printed.items.filter((i) => i.k === "text");
  for (const key of ["mmPayee", "mmAmount", "mmAmountText1", "mmAmountText2", "mmDate"]) {
    const field = (template.fields || {})[key];
    if (!field) continue;
    const x = field.left_mm * sf + a.ox;
    const y = field.top_mm * sf + a.oy + (key === "mmAmountText1" ? a.spacing : key === "mmAmountText2" ? 2 * a.spacing : 0);
    for (const item of texts) {
      const secondPayee = key === "mmPayee" && options.long_payee === "wrap" && Math.abs(item.y - y - (a.font * 1.2) / MM_TO_PT) < 0.011;
      if (Math.abs(item.x - x) < 0.011 && (Math.abs(item.y - y) < 0.011 || secondPayee)) {
        const base = item.y + item.size * 0.31;
        const em = item.size / MM_TO_PT;
        const box = [item.x, base - ASCENT * em, item.x + textWidthMm(item.text, item.size), base + DESCENT * em];
        const prev = regions[key];
        regions[key] = prev ? [Math.min(prev[0], box[0]), Math.min(prev[1], box[1]), Math.max(prev[2], box[2]), Math.max(prev[3], box[3])] : box;
      }
    }
  }
  const hasPhoto = !!template.background_image;
  return {
    scene: {
      widthMm: width,
      heightMm: height,
      printed: printed.items,
      guide: hasPhoto ? null : guideScene(template, data, account, width, height, followGuides),
    },
    widthMm: Number(fixed(width * MM_TO_PT, 2)) / MM_TO_PT,
    heightMm: Number(fixed(height * MM_TO_PT, 2)) / MM_TO_PT,
    hitRegions: regions,
  };
}

// ---- Request handling (what bridge.py did) ------------------------------------------------------
const LIMITS = [
  ["CCAC_CHEQUE_WIDTH", 60, 500], ["CCAC_CHEQUE_HEIGHT", 35, 500], ["CCAC_FONT_SIZE", 6, 30], ["CCAC_SCALE_PCT", 50, 200],
  ["CCAC_WRAP_CHARS", 15, 150], ["CCAC_PRINTER_OFFSET_X", -1000, 1000], ["CCAC_PRINTER_OFFSET_Y", -1000, 1000],
  ["CCAC_LINE_SPACING", -30, 30], ["CCAC_SHIFT_AC_PAYEE", -40, 40],
];
export function prepare(request) {
  let template = request.template;
  if (!isObject(template)) throw new Error("Invalid layout.");
  template = validateLayouts({ [template.id]: template })[template.id];
  const account = { ...request.account };
  for (const [key, low, high] of LIMITS) {
    const value = Number(account[key]);
    if (account[key] === null || account[key] === undefined || account[key] === "" || !Number.isFinite(value) || value < low || value > high)
      throw new Error("Invalid calibration: " + key);
    account[key] = value;
  }
  if (account.CCAC_WRAP_CHARS !== Math.trunc(account.CCAC_WRAP_CHARS)) throw new Error("Words line length must be a whole number.");
  const data = { ...request.cheque };
  const amount = money(data.CCT_AMOUNT ?? "0", data.CCT_CURRENCY ?? "AED", request.action !== "preview");
  const dec = parseDecimal(amount);
  if (!/^0*$/.test(dec.frac.slice(2)))
    throw new Error("The original printing engine supports two-decimal output. Correct the amount before printing.");
  data.CCT_AMOUNT = amount;
  data.CCT_DATE = isoDate(data.CCT_DATE, data.CCT_DATE === null || data.CCT_DATE === undefined);
  const style = data.CCT_WORDING_STYLE ?? "spelled_fils";
  if (!["standard", "spelled_fils", "with_currency", "AR"].includes(style)) throw new Error("Choose a wording style.");
  if (data.CCT_WORDING === null || data.CCT_WORDING === undefined)
    data.CCT_WORDING = amountToWords(amount, data.CCT_CURRENCY ?? "AED", style === "AR" ? "standard" : style, style === "AR" ? "AR" : "EN");
  for (const key of ["CCT_PAYEE", "CCT_WORDING", "CCT_CHEQUE_NO"])
    if (typeof data[key] !== "string" || Array.from(data[key]).length > 2000) throw new Error("Check cheque text length.");
  if (request.action !== "preview" && (!data.CCT_PAYEE.trim() || !data.CCT_CHEQUE_NO.trim()))
    throw new Error("Enter payee and cheque number.");
  if (![1, 2, 3].includes(data.CCT_CROSSING_OPTION)) throw new Error("Choose a crossing option.");
  const options = accountOptions(account, template.id);
  const payee = template.fields.mmPayee;
  const width = (num(payee.width_mm ?? 133) * account.CCAC_SCALE_PCT) / 100;
  const overflow =
    options.long_payee !== "keep" &&
    payeeTextLines(stripStars(data.CCT_PAYEE.trim()), options, width, account.CCAC_FONT_SIZE).some(([line, size]) => textWidthMm(line, size) > width + 0.05);
  if (overflow && request.action !== "preview")
    throw new Error("Payee exceeds the selected field even with this long-name option. Increase its width or choose another option; no name was truncated.");
  return { template, data, account, overflow };
}
