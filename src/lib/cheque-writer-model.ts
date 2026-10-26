import type { PreviewScene } from "./cheque-preview-draw";
export type NativeField = {
  left_mm: number;
  top_mm: number;
  width_mm?: number;
  height_mm?: number;
  [key: string]: unknown;
};
export type NativeLayout = {
  id: string;
  display_name?: string;
  fields: Record<string, NativeField>;
  background_image?: { format: "png"; data: string };
  [key: string]: unknown;
};
export type TextOptions = {
  payee_prefix: string;
  payee_suffix: string;
  long_payee: "keep" | "wrap" | "shrink";
  amount_prefix: string;
  amount_suffix: string;
  no_trailing_zeros: boolean;
  words_prefix: string;
  words_suffix: string;
  words_caps: boolean;
};
export const TEXT_DEFAULTS: TextOptions = {
  payee_prefix: "",
  payee_suffix: "",
  long_payee: "keep",
  amount_prefix: "**",
  amount_suffix: "**",
  no_trailing_zeros: true,
  words_prefix: "**",
  words_suffix: "**",
  words_caps: true,
};
export type Calibration = {
  width: number;
  height: number;
  font: number;
  scale: number;
  wrap: number;
  x: number;
  y: number;
  spacing: number;
  crossingShift: number;
  printer: string;
  tray: string;
  orientation: "Landscape" | "Portrait";
  feed: "cheque_only" | "a4_center_tray" | "a4_left_center_tray" | "a4_edge_tray";
  offsets: Record<string, { left_mm: number; top_mm: number }>;
  text: TextOptions;
};
export type WriterConfig = {
  version: 1;
  revision: number;
  layouts: Record<string, NativeLayout>;
  banks: Record<string, { layoutId: string; calibration: Record<string, Calibration> }>;
  /** Optional "Custom List" of payee names imported from the Cheque Printer app. */
  payees?: string[];
};
export const MAX_CUSTOM_PAYEES = 20000;
export function cleanPayeeList(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Choose a list of payee names.");
  const seen = new Set<string>(),
    result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") throw new Error("Payee names must be text.");
    const name = raw.trim();
    if (!name) continue;
    if (name.length > 500 || [...name].some((ch) => ch.charCodeAt(0) < 32))
      throw new Error("Payee names must be at most 500 characters without control characters.");
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  if (result.length > MAX_CUSTOM_PAYEES)
    throw new Error(`Use at most ${MAX_CUSTOM_PAYEES} payee names.`);
  return result;
}
export type WriterBank = { id: string; code: string; name: string; bankNo: string };
export type WriterValues = {
  number: string;
  payee: string;
  amount: string;
  date: string;
  blankDate: boolean;
  crossed: boolean;
  crossing: number;
  noBearer: boolean;
  payeeCaps: boolean;
  style: "spelled_fils" | "standard" | "with_currency" | "AR";
  wording: string | null;
};
export type EnginePreviewData = {
  scene: PreviewScene;
  widthMm: number;
  heightMm: number;
  hitRegions: Record<string, [number, number, number, number]>;
  words: string;
  outside: string[];
  source: string;
};
/** What the screen holds: the server's numbers plus the picture the browser drew from them. */
export type EnginePreview = Omit<EnginePreviewData, "scene"> & { png: string };
export type EnginePrinter = {
  name: string;
  is_default?: boolean;
  default_tray?: string;
  trays?: { name: string }[];
};
export type WriterRequest = {
  bankId: string;
  layout: NativeLayout;
  calibration: Calibration;
  values: WriterValues;
  followGuides?: boolean;
};
export function defaultCalibration(id = "ADCB"): Calibration {
  return {
    width: 201.8,
    height: 100.9,
    font: 12.5,
    scale: 100,
    wrap: id === "ADCB" ? 40 : 46,
    x: id === "ADCB" ? 5 : 0,
    y: id === "ADCB" ? 2 : 0,
    spacing: 0,
    crossingShift: 0,
    printer: "",
    tray: "Multi-purpose Tray",
    orientation: "Landscape",
    feed: "cheque_only",
    offsets: {},
    text: { ...TEXT_DEFAULTS },
  };
}
export function nextChequeNumber(value: string) {
  if (!/^\d{1,30}$/.test(value)) throw new Error("Enter a numeric cheque number before using +1.");
  return (BigInt(value) + 1n).toString().padStart(value.length, "0");
}
export function moveFields(cal: Calibration, keys: string[], dx: number, dy = 0): Calibration {
  const offsets = structuredClone(cal.offsets);
  for (const key of keys) {
    const old = offsets[key] || { left_mm: 0, top_mm: 0 };
    offsets[key] = {
      left_mm: Math.round((old.left_mm + (dx * 100) / cal.scale) * 1000) / 1000,
      top_mm: Math.round((old.top_mm + (dy * 100) / cal.scale) * 1000) / 1000,
    };
  }
  return { ...cal, offsets };
}
export function effectiveLayout(layout: NativeLayout, cal: Calibration) {
  const result = structuredClone(layout);
  for (const [key, delta] of Object.entries(cal.offsets)) {
    if (Object.hasOwn(result.fields, key)) {
      result.fields[key].left_mm += delta.left_mm;
      result.fields[key].top_mm += delta.top_mm;
    }
  }
  return result;
}
export function engineRequest(
  layout: NativeLayout,
  cal: Calibration,
  values: WriterValues,
  bank: WriterBank,
  currency: string,
) {
  return {
    template: effectiveLayout(layout, cal),
    feedMode: cal.feed,
    account: {
      CCAC_BANK_ID: layout.id,
      CCAC_NAME: bank.name,
      CCAC_NO: bank.bankNo,
      CCAC_CURRENCY: currency,
      CCAC_CHEQUE_WIDTH: cal.width,
      CCAC_CHEQUE_HEIGHT: cal.height,
      CCAC_FONT_SIZE: cal.font,
      CCAC_SCALE_PCT: cal.scale,
      CCAC_WRAP_CHARS: cal.wrap,
      CCAC_PRINTER_OFFSET_X: cal.x,
      CCAC_PRINTER_OFFSET_Y: cal.y,
      CCAC_LINE_SPACING: cal.spacing,
      CCAC_SHIFT_AC_PAYEE: cal.crossingShift,
      CCAC_PRINTER_NAME: cal.printer,
      CCAC_PRINTER_TRAY: cal.tray,
      CCAC_ORIENTATION: cal.orientation,
      CCAC_TEXT_OPTIONS: cal.text,
    },
    cheque: {
      CCT_CHEQUE_NO: values.number.trim(),
      CCT_PAYEE: values.payeeCaps ? values.payee.trim().toUpperCase() : values.payee.trim(),
      CCT_AMOUNT: values.amount || "0",
      CCT_CURRENCY: currency,
      CCT_DATE: values.blankDate ? null : values.date,
      CCT_AC_PAYEE_ONLY: values.crossed ? "Y" : "N",
      CCT_CROSSING_OPTION: values.crossing,
      CCT_NO_BEARER: values.noBearer ? "Y" : "N",
      CCT_WORDING_STYLE: values.style,
      CCT_WORDING: values.wording,
    },
  };
}
export function validateCalibration(input: Calibration): Calibration {
  if (!input || typeof input !== "object") throw new Error("Enter valid calibration settings.");
  const result = {
    ...input,
    text: { ...TEXT_DEFAULTS, ...input.text },
    offsets: input.offsets || {},
  };
  for (const [key, min, max] of [
    ["width", 60, 500],
    ["height", 35, 500],
    ["font", 6, 30],
    ["scale", 50, 200],
    ["wrap", 15, 150],
    ["x", -1000, 1000],
    ["y", -1000, 1000],
    ["spacing", -30, 30],
    ["crossingShift", -40, 40],
  ] as const)
    if (
      typeof result[key] !== "number" ||
      !Number.isFinite(result[key]) ||
      result[key] < min ||
      result[key] > max
    )
      throw new Error(`Check ${key}: use ${min} to ${max}.`);
  if (
    !Number.isInteger(result.wrap) ||
    !["Landscape", "Portrait"].includes(result.orientation) ||
    !["cheque_only", "a4_center_tray", "a4_left_center_tray", "a4_edge_tray"].includes(result.feed)
  )
    throw new Error("Choose valid feed and wording settings.");
  for (const key of ["printer", "tray"] as const)
    if (typeof result[key] !== "string" || result[key].length > 300)
      throw new Error("Choose a valid printer and tray.");
  if (Object.keys(result.offsets).length > 200) throw new Error("Too many field offsets.");
  for (const delta of Object.values(result.offsets))
    for (const value of [delta.left_mm, delta.top_mm])
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1000)
        throw new Error("Invalid field offset.");
  for (const key of [
    "payee_prefix",
    "payee_suffix",
    "amount_prefix",
    "amount_suffix",
    "words_prefix",
    "words_suffix",
  ] as const)
    if (
      typeof result.text[key] !== "string" ||
      result.text[key].length > 80 ||
      /[\x00-\x1f]/.test(result.text[key])
    )
      throw new Error("Prefixes and suffixes allow 80 printable characters.");
  if (
    !["keep", "wrap", "shrink"].includes(result.text.long_payee) ||
    typeof result.text.no_trailing_zeros !== "boolean" ||
    typeof result.text.words_caps !== "boolean"
  )
    throw new Error("Choose valid cheque text options.");
  return result;
}

/** Plain names for the field list of the layout editor (display only; saved layouts keep their internal keys). */
const FIELD_LABELS: Record<string, string> = {
  mmPayee: "Payee name",
  mmPayee2: "Payee name, second line",
  mmPayeeOnly: "\"A/C Payee Only\" text (crossing)",
  lnPayee1: "Crossing line 1",
  lnPayee2: "Crossing line 2",
  mmNoBearer: "\"Or bearer\" cancel mark",
  mmD1: "Date: day, digit 1",
  mmD2: "Date: day, digit 2",
  mmM1: "Date: month, digit 1",
  mmM2: "Date: month, digit 2",
  mmY1: "Date: year, digit 1",
  mmY2: "Date: year, digit 2",
  mmY3: "Date: year, digit 3",
  mmY4: "Date: year, digit 4",
  mmS1: "Date: separator 1",
  mmS2: "Date: separator 2",
  mmAmount: "Amount in figures",
  mmAmountText1: "Amount in words, line 1",
  mmAmountText2: "Amount in words, line 2",
  mmBank: "Bank name",
};
export function chequeFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}
