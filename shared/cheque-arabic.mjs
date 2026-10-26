// Arabic on the cheque: letter joining, right-to-left order and the embedded font for the PDF.
// The PDF writer here has no text engine, so the work is done in this file: shape (join the letters
// into their presentation forms), reorder (visual order), then look the glyphs up in the font.
// The font file (Noto Naskh Arabic, SIL Open Font License) is given once with setArabicFont().
export const FORMS = {
  0x621: [0xFE80,0,0,0],
  0x622: [0xFE81,0xFE82,0,0],
  0x623: [0xFE83,0xFE84,0,0],
  0x624: [0xFE85,0xFE86,0,0],
  0x625: [0xFE87,0xFE88,0,0],
  0x626: [0xFE89,0xFE8A,0xFE8B,0xFE8C],
  0x627: [0xFE8D,0xFE8E,0,0],
  0x628: [0xFE8F,0xFE90,0xFE91,0xFE92],
  0x629: [0xFE93,0xFE94,0,0],
  0x62A: [0xFE95,0xFE96,0xFE97,0xFE98],
  0x62B: [0xFE99,0xFE9A,0xFE9B,0xFE9C],
  0x62C: [0xFE9D,0xFE9E,0xFE9F,0xFEA0],
  0x62D: [0xFEA1,0xFEA2,0xFEA3,0xFEA4],
  0x62E: [0xFEA5,0xFEA6,0xFEA7,0xFEA8],
  0x62F: [0xFEA9,0xFEAA,0,0],
  0x630: [0xFEAB,0xFEAC,0,0],
  0x631: [0xFEAD,0xFEAE,0,0],
  0x632: [0xFEAF,0xFEB0,0,0],
  0x633: [0xFEB1,0xFEB2,0xFEB3,0xFEB4],
  0x634: [0xFEB5,0xFEB6,0xFEB7,0xFEB8],
  0x635: [0xFEB9,0xFEBA,0xFEBB,0xFEBC],
  0x636: [0xFEBD,0xFEBE,0xFEBF,0xFEC0],
  0x637: [0xFEC1,0xFEC2,0xFEC3,0xFEC4],
  0x638: [0xFEC5,0xFEC6,0xFEC7,0xFEC8],
  0x639: [0xFEC9,0xFECA,0xFECB,0xFECC],
  0x63A: [0xFECD,0xFECE,0xFECF,0xFED0],
  0x641: [0xFED1,0xFED2,0xFED3,0xFED4],
  0x642: [0xFED5,0xFED6,0xFED7,0xFED8],
  0x643: [0xFED9,0xFEDA,0xFEDB,0xFEDC],
  0x644: [0xFEDD,0xFEDE,0xFEDF,0xFEE0],
  0x645: [0xFEE1,0xFEE2,0xFEE3,0xFEE4],
  0x646: [0xFEE5,0xFEE6,0xFEE7,0xFEE8],
  0x647: [0xFEE9,0xFEEA,0xFEEB,0xFEEC],
  0x648: [0xFEED,0xFEEE,0,0],
  0x649: [0xFEEF,0xFEF0,0xFBE8,0xFBE9],
  0x64A: [0xFEF1,0xFEF2,0xFEF3,0xFEF4],
  0x671: [0xFB50,0xFB51,0,0],
  0x677: [0xFBDD,0,0,0],
  0x679: [0xFB66,0xFB67,0xFB68,0xFB69],
  0x67A: [0xFB5E,0xFB5F,0xFB60,0xFB61],
  0x67B: [0xFB52,0xFB53,0xFB54,0xFB55],
  0x67E: [0xFB56,0xFB57,0xFB58,0xFB59],
  0x67F: [0xFB62,0xFB63,0xFB64,0xFB65],
  0x680: [0xFB5A,0xFB5B,0xFB5C,0xFB5D],
  0x683: [0xFB76,0xFB77,0xFB78,0xFB79],
  0x684: [0xFB72,0xFB73,0xFB74,0xFB75],
  0x686: [0xFB7A,0xFB7B,0xFB7C,0xFB7D],
  0x687: [0xFB7E,0xFB7F,0xFB80,0xFB81],
  0x688: [0xFB88,0xFB89,0,0],
  0x68C: [0xFB84,0xFB85,0,0],
  0x68D: [0xFB82,0xFB83,0,0],
  0x68E: [0xFB86,0xFB87,0,0],
  0x691: [0xFB8C,0xFB8D,0,0],
  0x698: [0xFB8A,0xFB8B,0,0],
  0x6A4: [0xFB6A,0xFB6B,0xFB6C,0xFB6D],
  0x6A6: [0xFB6E,0xFB6F,0xFB70,0xFB71],
  0x6A9: [0xFB8E,0xFB8F,0xFB90,0xFB91],
  0x6AD: [0xFBD3,0xFBD4,0xFBD5,0xFBD6],
  0x6AF: [0xFB92,0xFB93,0xFB94,0xFB95],
  0x6B1: [0xFB9A,0xFB9B,0xFB9C,0xFB9D],
  0x6B3: [0xFB96,0xFB97,0xFB98,0xFB99],
  0x6BA: [0xFB9E,0xFB9F,0,0],
  0x6BB: [0xFBA0,0xFBA1,0xFBA2,0xFBA3],
  0x6BE: [0xFBAA,0xFBAB,0xFBAC,0xFBAD],
  0x6C0: [0xFBA4,0xFBA5,0,0],
  0x6C1: [0xFBA6,0xFBA7,0xFBA8,0xFBA9],
  0x6C5: [0xFBE0,0xFBE1,0,0],
  0x6C6: [0xFBD9,0xFBDA,0,0],
  0x6C7: [0xFBD7,0xFBD8,0,0],
  0x6C8: [0xFBDB,0xFBDC,0,0],
  0x6C9: [0xFBE2,0xFBE3,0,0],
  0x6CB: [0xFBDE,0xFBDF,0,0],
  0x6CC: [0xFBFC,0xFBFD,0xFBFE,0xFBFF],
  0x6D0: [0xFBE4,0xFBE5,0xFBE6,0xFBE7],
  0x6D2: [0xFBAE,0xFBAF,0,0],
  0x6D3: [0xFBB0,0xFBB1,0,0],
};
export const LAM_ALEF = {
  0x622: [0xFEF5,0xFEF6],
  0x623: [0xFEF7,0xFEF8],
  0x625: [0xFEF9,0xFEFA],
  0x627: [0xFEFB,0xFEFC],
  0x62C: [0xFC3F,0xFCC9],
  0x62D: [0xFC40,0xFCCA],
  0x62E: [0xFC41,0xFCCB],
  0x645: [0xFC42,0xFCED],
  0x647: [0x0,0xFCCD],
  0x649: [0xFC43,0xFC86],
  0x64A: [0xFC44,0xFC87],
};

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const isArabic = (text) => ARABIC.test(String(text ?? ""));
const isArabicChar = (ch) => ARABIC.test(ch);
const DIACRITIC = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;

// ---- joining -------------------------------------------------------------------------------------
const joinsNext = (cp) => !!FORMS[cp]?.[2] || cp === 0x640; // can join to the letter after it (dual joining)
const joinsPrev = (cp) => !!FORMS[cp]?.[1] || cp === 0x640; // can join to the letter before it
function shapeLogical(text) {
  const cps = Array.from(text.replace(DIACRITIC, ""), (c) => c.codePointAt(0));
  const out = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp === 0x644 && LAM_ALEF[cps[i + 1]]) {
      const before = i > 0 && joinsNext(cps[i - 1]);
      out.push(LAM_ALEF[cps[i + 1]][before ? 1 : 0]);
      i++;
      continue;
    }
    const f = FORMS[cp];
    if (!f) {
      out.push(cp);
      continue;
    }
    const before = i > 0 && joinsNext(cps[i - 1]);
    const after = i + 1 < cps.length && joinsPrev(cps[i + 1]) && joinsNext(cp);
    let form = f[0];
    if (before && after) form = f[3] || f[1] || f[0];
    else if (before) form = f[1] || f[0];
    else if (after) form = f[2] || f[0];
    out.push(form || cp);
  }
  return out;
}

// ---- order ---------------------------------------------------------------------------------------
// Runs of Arabic read right to left; Latin letters and digits keep their own left-to-right order.
const kind = (ch) => (isArabicChar(ch) && !ARABIC_DIGIT.test(ch) ? "R" : /[A-Za-z0-9\u00C0-\u024F]/.test(ch) || ARABIC_DIGIT.test(ch) ? "L" : "N");
// The text as a list of stretches in the order they are drawn (left to right):
// { arabic: true, text } is drawn with the Arabic font, { arabic: false, text } with the Latin font.
export function visualRuns(text) {
  const chars = Array.from(String(text ?? ""));
  const k = chars.map(kind);
  if (!k.includes("R")) return [{ arabic: false, text: chars.join("") }];
  // A neutral (space, dash, dot) between two left-to-right characters stays with them.
  for (let i = 0; i < k.length; i++) {
    if (k[i] !== "N") continue;
    let a = i;
    while (a < k.length && k[a] === "N") a++;
    if (i > 0 && a < k.length && k[i - 1] === "L" && k[a] === "L") for (let j = i; j < a; j++) k[j] = "L";
    i = a - 1;
  }
  const runs = [];
  for (let i = 0; i < chars.length; i++) {
    const side = k[i] === "L" ? "L" : "R";
    const last = runs[runs.length - 1];
    if (last && last.side === side) last.chars.push(chars[i]);
    else runs.push({ side, chars: [chars[i]] });
  }
  return runs
    .reverse()
    .map((r) =>
      r.side === "R"
        ? { arabic: true, text: shapeLogical(r.chars.join("")).reverse().map((cp) => String.fromCodePoint(cp)).join("") }
        : { arabic: false, text: r.chars.join("") },
    );
}
export const shapeVisual = (text) => visualRuns(text).map((r) => r.text).join("");

// ---- the font ------------------------------------------------------------------------------------
let font = null;
const u16 = (v, o) => v.getUint16(o);
const i16 = (v, o) => v.getInt16(o);
const u32 = (v, o) => v.getUint32(o);
export function setArabicFont(bytes) {
  if (!bytes) {
    font = null;
    return;
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = {};
  const count = u16(v, 4);
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
    tables[tag] = { offset: u32(v, o + 8), length: u32(v, o + 12) };
  }
  for (const need of ["cmap", "head", "hhea", "hmtx", "maxp", "glyf"]) if (!tables[need]) throw new Error("The Arabic font file is not a TrueType font.");
  const unitsPerEm = u16(v, tables.head.offset + 18);
  const bbox = [i16(v, tables.head.offset + 36), i16(v, tables.head.offset + 38), i16(v, tables.head.offset + 40), i16(v, tables.head.offset + 42)];
  const ascent = i16(v, tables.hhea.offset + 4);
  const descent = i16(v, tables.hhea.offset + 6);
  const metrics = u16(v, tables.hhea.offset + 34);
  // character -> glyph (format 4 for the main plane)
  const cmap = new Map();
  const cm = tables.cmap.offset;
  const subs = u16(v, cm + 2);
  for (let s = 0; s < subs; s++) {
    const platform = u16(v, cm + 4 + s * 8);
    const encoding = u16(v, cm + 6 + s * 8);
    const off = cm + u32(v, cm + 8 + s * 8);
    if (u16(v, off) !== 4 || !((platform === 3 && encoding === 1) || platform === 0)) continue;
    const segs = u16(v, off + 6) / 2;
    const end = off + 14,
      start = end + segs * 2 + 2,
      delta = start + segs * 2,
      range = delta + segs * 2;
    for (let g = 0; g < segs; g++) {
      const e = u16(v, end + g * 2),
        st = u16(v, start + g * 2),
        d = i16(v, delta + g * 2),
        ro = u16(v, range + g * 2);
      for (let c = st; c <= e && c < 0xffff; c++) {
        let gid;
        if (ro === 0) gid = (c + d) & 0xffff;
        else {
          const p = range + g * 2 + ro + (c - st) * 2;
          gid = u16(v, p);
          if (gid) gid = (gid + d) & 0xffff;
        }
        if (gid) cmap.set(c, gid);
      }
    }
    break;
  }
  if (!cmap.size) throw new Error("The Arabic font file has no character table.");
  const advance = (gid) => u16(v, tables.hmtx.offset + Math.min(gid, metrics - 1) * 4);
  font = { data, unitsPerEm, bbox, ascent, descent, cmap, advance };
}
export const arabicFontLoaded = () => !!font;
export const arabicFontBytes = () => font?.data ?? null;
export const arabicFontInfo = () => font && { unitsPerEm: font.unitsPerEm, bbox: font.bbox, ascent: font.ascent, descent: font.descent };

// Glyphs of one Arabic stretch (already in visual order), left to right.
export function glyphsOf(visualText) {
  return Array.from(visualText, (ch) => {
    const gid = font?.cmap.get(ch.codePointAt(0)) ?? font?.cmap.get(0x20) ?? 0;
    return { gid, width: font ? font.advance(gid) : 500 };
  });
}
// Width in 1/1000 em of an Arabic stretch.
export function arabicRunUnits(visualText) {
  if (!font) return Array.from(visualText).length * 550;
  return glyphsOf(visualText).reduce((sum, g) => sum + (g.width * 1000) / font.unitsPerEm, 0);
}
