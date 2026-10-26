// Template Printer: layout, PDF and printing flow. The six PDFs in tests/fixtures/template were made by the
// original SJMR Template Printer program itself; the PDF built here must equal them byte for byte.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULTS, gapLines, orient, plan, positions, sizeFromDpi, verticalLines } from "../src/lib/template-layout.ts";
import { buildPdf } from "../src/lib/template-pdf.ts";
import { createTemplatePrinter } from "../core/template.mjs";
import { checkTemplateSettings, TEMPLATE_DEFAULTS } from "../core/template-settings.mjs";

const dir = path.join(import.meta.dirname, "fixtures", "template");
const cases = JSON.parse(fs.readFileSync(path.join(dir, "cases.json"), "utf8"));
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} is not near ${b}`);

test("the PDF equals what the original program writes, for every kind of layout", () => {
  for (const [name, over] of Object.entries(cases)) {
    const original = fs.readFileSync(path.join(dir, `${name}.pdf`));
    const m = /\/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/.exec(original.toString("latin1"));
    assert.ok(m, `${name}: picture found`);
    const start = m.index + m[0].length;
    const jpeg = new Uint8Array(original.subarray(start, start + Number(m[3])));
    const mine = Buffer.from(buildPdf(jpeg, Number(m[1]), Number(m[2]), { ...DEFAULTS, ...over }));
    assert.ok(Buffer.compare(original, mine) === 0, `${name}: identical to the original program's PDF`);
  }
});

test("the examples of the original README", () => {
  // 201.9 x 100.9, 2 copies, A4 portrait, margin 4, gap 10: side margins 4.05, top and bottom 42.6.
  const s = { ...DEFAULTS };
  const p = plan(s);
  assert.deepEqual([p.cols, p.rows, p.capacity, p.pages], [1, 2, 2, 1]);
  const [a, b] = positions(s, p, 0);
  near(a.x, 4.05);
  near(a.y, 42.6);
  near(b.y - (a.y + a.h), 10);
  near(s.pageH - (b.y + b.h), 42.6);
  // Three copies: two pages (2 + 1).
  const three = { ...s, copies: 3 };
  assert.equal(plan(three).pages, 2);
  assert.equal(positions(three, plan(three), 1).length, 1);
  // 2400 x 1200 pixels at 300 DPI.
  assert.deepEqual(sizeFromDpi(2400, 1200, 300), { width: 203.2, height: 101.6 });
  assert.throws(() => sizeFromDpi(2400, 1200, 0), /positive scan DPI/);
  assert.throws(() => sizeFromDpi(2400, 1200, 0.001), /outside the supported range/);
});

test("refusals: nothing is ever shrunk", () => {
  assert.throws(() => plan({ ...DEFAULTS, width: 205 }), /does not fit at this exact size/);
  assert.throws(() => plan({ ...DEFAULTS, offsetX: 50 }), /outside the paper/);
  assert.throws(() => plan({ ...DEFAULTS, copies: 0 }), /positive sizes and at least one copy/);
  assert.throws(() => plan({ ...DEFAULTS, width: Number.NaN }), /numbers/);
  assert.deepEqual(orient(210, 297, true), { pageW: 297, pageH: 210 });
});

test("centre lines: only between rows and columns, never on a single row or column", () => {
  const single = { ...DEFAULTS, copies: 1, hLines: true, vLines: true };
  assert.deepEqual(gapLines(single, plan(single), 0), []);
  assert.deepEqual(verticalLines(single, plan(single), 0), []);
  const grid = { ...DEFAULTS, width: 95, height: 45, gap: 6, copies: 5, hLines: true, vLines: true };
  const p = plan(grid);
  assert.deepEqual([p.cols, p.rows], [2, 5]);
  assert.equal(gapLines(grid, p, 0).length, 2, "three rows of 2, 2, 1");
  assert.equal(verticalLines(grid, p, 0).length, 2, "a vertical guide only in the two full rows");
  assert.deepEqual(gapLines({ ...grid, gap: 0 }, plan({ ...grid, gap: 0 }), 0), []);
});

test("remembered settings keep only valid values", () => {
  assert.deepEqual(checkTemplateSettings(null), TEMPLATE_DEFAULTS);
  const v = checkTemplateSettings({ width: 150.5, copies: 3.9, borderMm: 9, paper: "A5", landscape: true, junk: 1, hLines: "yes", printer: "HP" });
  assert.equal(v.width, 150.5);
  assert.equal(v.copies, 3);
  assert.equal(v.borderMm, TEMPLATE_DEFAULTS.borderMm, "out of range: default");
  assert.equal(v.paper, "A5");
  assert.equal(v.landscape, true);
  assert.equal(v.hLines, false);
  assert.equal(v.printer, "HP");
  assert.equal("junk" in v, false);
});

test("printing: one job at a time, the job reaches the helper, refusals are plain", async () => {
  const calls = [];
  const outputs = ["PRINTED_OK|HP LaserJet|2"];
  const printer = createTemplatePrinter({
    platform: "win32",
    runHelper: async (input) => {
      calls.push(input);
      return { code: 0, out: input.args.includes("list") ? '[{"name":"HP","is_default":true,"papers":[]}]' : outputs.shift() ?? "", err: "" };
    },
  });
  assert.equal((await printer.printers()).printers[0].name, "HP");
  assert.equal(calls[0].script, "template-print.ps1");
  const job = { printer_name: "HP", show_dialog: false, page_w_mm: 210, page_h_mm: 297, image_base64: "AAAA", border_mm: 0, pages: [{ rects: [], lines: [] }, { rects: [], lines: [] }] };
  const done = await printer.print(job);
  assert.equal(done.ok, true);
  assert.match(done.message, /Sent 2 page\(s\) to 'HP LaserJet'/);
  assert.equal(JSON.parse(calls[1].job).pages.length, 2);
  assert.equal(calls[1].visible, false);
  await assert.rejects(printer.print({ ...job, pages: [] }), /print job is empty/);
  const cancelled = createTemplatePrinter({ platform: "win32", runHelper: async () => ({ code: 0, out: "CANCELLED", err: "" }) });
  assert.equal((await cancelled.print({ ...job, show_dialog: true })).cancelled, true);
  const refused = createTemplatePrinter({ platform: "win32", runHelper: async () => ({ code: 3, out: "", err: "The printer did not accept the selected paper size." }) });
  await assert.rejects(refused.print(job), /did not accept the selected paper size/);
  await assert.rejects(createTemplatePrinter({ platform: "other", runHelper: async () => ({}) }).print(job), /requires the main Windows program/);
  assert.deepEqual((await createTemplatePrinter({ platform: "other" }).printers()).printers, []);
});
