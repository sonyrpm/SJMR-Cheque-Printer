// What the Template Printer remembers between runs (never the picture): sizes, paper, options.
export const TEMPLATE_DEFAULTS = {
  dpi: 300,
  width: 201.9,
  height: 100.9,
  copies: 2,
  printer: "",
  paper: "A4",
  landscape: false,
  pageW: 210,
  pageH: 297,
  margin: 4,
  gap: 10,
  border: false,
  borderMm: 0.05,
  hLines: false,
  vLines: false,
  offsetX: 0,
  offsetY: 0,
};

/** Keeps only known fields with sensible types and ranges; anything else falls back to the default. */
export function checkTemplateSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = { ...TEMPLATE_DEFAULTS };
  const number = (key, low, high) => {
    const v = Number(source[key]);
    if (source[key] !== "" && source[key] !== null && Number.isFinite(v) && v >= low && v <= high) out[key] = v;
  };
  number("dpi", 1, 100000);
  number("width", 0.01, 5000);
  number("height", 0.01, 5000);
  number("copies", 1, 1000);
  out.copies = Math.trunc(out.copies);
  number("pageW", 1, 5000);
  number("pageH", 1, 5000);
  number("margin", 0, 5000);
  number("gap", 0, 5000);
  number("borderMm", 0.01, 2);
  number("offsetX", -1000, 1000);
  number("offsetY", -1000, 1000);
  for (const key of ["landscape", "border", "hLines", "vLines"]) if (typeof source[key] === "boolean") out[key] = source[key];
  for (const key of ["printer", "paper"]) if (typeof source[key] === "string" && source[key].length <= 200) out[key] = source[key];
  return out;
}
