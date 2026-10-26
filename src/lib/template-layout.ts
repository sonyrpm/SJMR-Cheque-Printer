// Template Printer layout: how many copies of a picture fit on a sheet and where each one goes.
// Ported from the SJMR Template Printer program (millimetres, origin at the top left of the sheet).
// Plain TypeScript without imports, so the tests run it directly.

export type TemplateSettings = {
  width: number; // picture width, mm
  height: number; // picture height, mm
  pageW: number; // paper width, mm (after orientation)
  pageH: number; // paper height, mm
  margin: number; // minimum margin on all four sides
  gap: number; // space between copies
  copies: number;
  border: boolean; // cutting border around every picture
  borderMm: number; // border thickness
  hLines: boolean; // horizontal centre lines between rows
  vLines: boolean; // vertical centre lines between columns
  offsetX: number; // micro-adjustment, + right
  offsetY: number; // micro-adjustment, + down
};
export type Rect = { x: number; y: number; w: number; h: number };
export type Plan = { cols: number; rows: number; capacity: number; pages: number };
export type VLine = { x: number; top: number; bottom: number };

export const DEFAULTS: TemplateSettings = {
  width: 201.9,
  height: 100.9,
  pageW: 210,
  pageH: 297,
  margin: 4,
  gap: 10,
  copies: 2,
  border: false,
  borderMm: 0.05,
  hLines: false,
  vLines: false,
  offsetX: 0,
  offsetY: 0,
};

// The original program keeps positions as 32-bit floats; the same rounding keeps the PDF identical to its output.
const f = Math.fround;
const right = (r: Rect) => f(r.x + r.w);
const bottom = (r: Rect) => f(r.y + r.h);

/** Checks the settings and works out the grid. Throws a plain message when the picture cannot be placed. */
export function plan(s: TemplateSettings): Plan {
  const numbers = [s.width, s.height, s.pageW, s.pageH, s.margin, s.gap, s.copies, s.offsetX, s.offsetY, s.borderMm];
  if (numbers.some((n) => !Number.isFinite(n))) throw new Error("Enter numbers in every size box.");
  if (s.width <= 0 || s.height <= 0 || s.pageW <= 0 || s.pageH <= 0 || s.margin < 0 || s.gap < 0 || s.copies < 1)
    throw new Error("Enter positive sizes and at least one copy.");
  const cols = Math.floor((s.pageW - 2 * s.margin + s.gap + 1e-8) / (s.width + s.gap));
  const rows = Math.floor((s.pageH - 2 * s.margin + s.gap + 1e-8) / (s.height + s.gap));
  if (cols < 1 || rows < 1) throw new Error("The image does not fit at this exact size. Reduce margins, select landscape or use larger paper.");
  const capacity = cols * rows;
  const pages = Math.ceil(s.copies / capacity);
  const result = { cols, rows, capacity, pages };
  for (let p = 0; p < pages; p++)
    for (const r of positions(s, result, p))
      if (r.x < -0.0001 || r.y < -0.0001 || right(r) > s.pageW + 0.0001 || bottom(r) > s.pageH + 0.0001)
        throw new Error("Micro-adjustment moves a picture outside the paper. Reduce the offset or choose larger paper.");
  return result;
}

/** The pictures on one page (0-based), centred as a group, then moved by the micro-adjustment. */
export function positions(s: TemplateSettings, p: Plan, page: number): Rect[] {
  const count = Math.min(p.capacity, s.copies - page * p.capacity);
  const out: Rect[] = [];
  if (count <= 0) return out;
  const cols = Math.min(p.cols, count);
  const rows = Math.ceil(count / cols);
  const top = (s.pageH - (rows * s.height + (rows - 1) * s.gap)) / 2;
  for (let row = 0; row < rows; row++) {
    const n = Math.min(cols, count - row * cols);
    const left = (s.pageW - (n * s.width + (n - 1) * s.gap)) / 2;
    for (let col = 0; col < n; col++)
      out.push({ x: f(left + col * (s.width + s.gap) + s.offsetX), y: f(top + row * (s.height + s.gap) + s.offsetY), w: f(s.width), h: f(s.height) });
  }
  return out;
}

function byRow(list: Rect[]): Rect[][] {
  const groups = new Map<number, Rect[]>();
  for (const r of list) groups.set(r.y, [...(groups.get(r.y) ?? []), r]);
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, rects]) => rects);
}

/** Vertical hairlines halfway between columns; on an incomplete row they stop at the row boundary. */
export function verticalLines(s: TemplateSettings, p: Plan, page: number): VLine[] {
  const lines: VLine[] = [];
  if (!s.vLines || s.gap <= 0) return lines;
  const rows = byRow(positions(s, p, page));
  rows.forEach((row, index) => {
    const cells = [...row].sort((a, b) => a.x - b.x);
    const top = index === 0 ? f(s.margin) : f(f(Math.max(...rows[index - 1].map(bottom)) + cells[0].y) / 2);
    const end = index === rows.length - 1 ? f(s.pageH - s.margin) : f(f(bottom(cells[0]) + rows[index + 1][0].y) / 2);
    for (let col = 0; col < cells.length - 1; col++) lines.push({ x: f(f(right(cells[col]) + cells[col + 1].x) / 2), top, bottom: f(top + f(end - top)) });
  });
  return lines;
}

/** Horizontal hairlines halfway between each pair of rows (y positions). */
export function gapLines(s: TemplateSettings, p: Plan, page: number): number[] {
  const lines: number[] = [];
  if (!s.hLines || s.gap <= 0) return lines;
  const rows = byRow(positions(s, p, page));
  for (let i = 0; i < rows.length - 1; i++) {
    const end = Math.max(...rows[i].map(bottom));
    const next = rows[i + 1][0].y;
    if (next > end) lines.push(f(f(end + next) / 2));
  }
  return lines;
}

/** Picture size in mm from its pixels and the scan resolution: pixels x 25.4 / dpi, to 0.01 mm. */
export function sizeFromDpi(pixelWidth: number, pixelHeight: number, dpi: number): { width: number; height: number } {
  if (!(pixelWidth > 0) || !(pixelHeight > 0) || !Number.isFinite(dpi) || dpi <= 0) throw new Error("Enter a positive scan DPI and choose a valid picture.");
  const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const width = round((pixelWidth * 25.4) / dpi);
  const height = round((pixelHeight * 25.4) / dpi);
  if (width < 0.01 || height < 0.01 || width > 5000 || height > 5000)
    throw new Error("The calculated size is outside the supported range (0.01 to 5000 mm). Check the scan DPI.");
  return { width, height };
}

/** Paper in the chosen orientation (presets only; custom paper is entered as it is). */
export function orient(w: number, h: number, landscape: boolean): { pageW: number; pageH: number } {
  const short = Math.min(w, h),
    long = Math.max(w, h);
  return landscape ? { pageW: long, pageH: short } : { pageW: short, pageH: long };
}

export const summary = (s: TemplateSettings, p: Plan) =>
  `Fits ${p.capacity} per page | ${p.pages} page(s) total\nExact image: ${+s.width.toFixed(2)} x ${+s.height.toFixed(2)} mm\nOffset: X ${signed(s.offsetX)} / Y ${signed(s.offsetY)} mm.`;
function signed(v: number) {
  const x = +v.toFixed(2);
  return x > 0 ? `+${x}` : `${x}`;
}
