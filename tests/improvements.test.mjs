import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCore } from "../core/index.mjs";
import { arabicFontLoaded, setArabicFont, shapeVisual, visualRuns } from "../shared/cheque-arabic.mjs";
import * as core from "../shared/cheque-core.mjs";
import { startHarness } from "./helpers/ui-harness.mjs";
import { memoryStore, nodeDb } from "./helpers/node-host.mjs";
import { suggestArabic } from "../src/lib/arabic-names.ts";
import { parseBatch } from "../src/lib/batch-rows.ts";
import { defaultCalibration, dragKeys, effectiveLayout } from "../src/lib/cheque-writer-model.ts";

const root = path.resolve(import.meta.dirname, "..");
const layouts = JSON.parse(fs.readFileSync(path.join(root, "shared/bank-layouts.json"), "utf8"));
const font = fs.readFileSync(path.join(root, "public/fonts/NotoNaskhArabic-Regular.ttf"));
const account = { CCAC_NO: "123", CCAC_NAME: "Test", CCAC_CHEQUE_WIDTH: 190, CCAC_CHEQUE_HEIGHT: 90, CCAC_FONT_SIZE: 12.5, CCAC_SCALE_PCT: 100, CCAC_WRAP_CHARS: 40, CCAC_PRINTER_OFFSET_X: 0, CCAC_PRINTER_OFFSET_Y: 0, CCAC_LINE_SPACING: 0, CCAC_SHIFT_AC_PAYEE: 0 };
const cheque = (over = {}) => ({ CCT_PAYEE: "SAMPLE CO", CCT_AMOUNT: "12345.50", CCT_CURRENCY: "AED", CCT_DATE: "2026-11-03", CCT_CHEQUE_NO: "000123", CCT_CROSSING_OPTION: 1, CCT_WORDING_STYLE: "spelled_fils", ...over });
const run = (over, action = "pdf") => core.prepare({ template: { ...layouts.ADCB, id: "ADCB" }, account, cheque: cheque(over), action });

test("Arabic letters are joined and ordered right to left, Latin names keep their order", () => {
  setArabicFont(font);
  assert.ok(arabicFontLoaded());
  // محمد: initial meem, medial hah, medial meem, final dal -> drawn left to right as dal, meem, hah, meem
  assert.deepEqual([...shapeVisual("محمد")].map((c) => c.codePointAt(0)), [0xfeaa, 0xfee4, 0xfea4, 0xfee3]);
  const runs = visualRuns("شركة ABC 123");
  assert.equal(runs[0].arabic, false);
  assert.equal(runs[0].text, "ABC 123", "Latin text and numbers stay left to right, to the left of the Arabic");
  assert.equal(runs[1].arabic, true);
  // lam + alef becomes one joined letter
  assert.equal([...shapeVisual("لا")].length, 1);
});

test("an Arabic cheque PDF embeds the Arabic font; an English one stays as it was", () => {
  setArabicFont(font);
  const english = run({});
  const pdfEnglish = core.chequePdf(english.template, english.data, english.account);
  assert.ok(!Buffer.from(pdfEnglish).includes("FontFile2"), "no font is embedded when no Arabic is printed");
  const arabic = run({ CCT_PAYEE: "شركة الخليج للتجارة ذ.م.م ABC", CCT_WORDING_STYLE: "AR" });
  const pdf = Buffer.from(core.chequePdf(arabic.template, arabic.data, arabic.account));
  assert.ok(pdf.includes("/Subtype /Type0") && pdf.includes("FontFile2") && pdf.includes("Identity-H"));
  assert.ok(pdf.includes(font.subarray(0, 4)) && pdf.length > font.length, "the font file is inside the PDF");
  // the Arabic payee is not turned into question marks
  assert.ok(!/\?\?\?/.test(pdf.toString("latin1").split("stream")[1] ?? ""), "no question-mark text");
  // the direct print job marks Arabic as right-to-left, anchored at the right end of the field
  const job = core.directJob(arabic.template, arabic.data, arabic.account, "a4_center_tray", "Landscape");
  const t = job.texts.find((x) => x.rtl);
  assert.ok(t && t.anchored && t.x_mm > 60);
});

test("every piece of writing can be grabbed on its own in the preview", () => {
  setArabicFont(font);
  const { template, data, account: acc } = run({}, "preview");
  const view = core.chequePreview(template, data, acc, true);
  for (const key of ["mmPayee", "mmD1", "mmAmount", "mmAmountText1", "crossing", "mmNoBearer"]) assert.ok(view.hitRegions[key], `${key} has its own area`);
  // the date no longer falls back to "move everything": its area is small and sits where the date is written
  const [l, t2, r, b] = view.hitRegions.mmD1;
  assert.ok(r - l < 60 && b - t2 < 12);
  // Arabic: the area sits at the right end of the payee field
  const ar = run({ CCT_PAYEE: "شركة الخليج" }, "preview");
  const v2 = core.chequePreview(ar.template, ar.data, ar.account, true);
  const field = ar.template.fields.mmPayee;
  assert.ok(v2.hitRegions.mmPayee[2] > field.left_mm + 100, "Arabic payee is written at the right end of its field");
});

test("crossing option 4 draws the two lines without any text; the date moves as one piece", () => {
  setArabicFont(font);
  const stamped = run({ CCT_CROSSING_OPTION: 1 }, "direct");
  const linesOnly = run({ CCT_CROSSING_OPTION: 4 }, "direct");
  const a = core.directJob(stamped.template, stamped.data, stamped.account, "a4_center_tray", "Landscape");
  const b = core.directJob(linesOnly.template, linesOnly.data, linesOnly.account, "a4_center_tray", "Landscape");
  assert.equal(b.lines.length, a.lines.length, "the two crossing lines stay");
  assert.equal(b.texts.length, a.texts.length - 1, "only the A/C PAYEE ONLY text is gone");
  assert.ok(!b.texts.some((t) => /A\/C PAYEE|NEGOTIABLE/.test(t.text)));
  const moved = effectiveLayout(layouts.ADCB, { ...defaultCalibration(), offsets: Object.fromEntries(dragKeys("mmY3").map((k) => [k, { left_mm: 4, top_mm: 0 }])) });
  for (const k of ["mmD1", "mmD2", "mmM1", "mmM2", "mmY1", "mmY4"]) if (layouts.ADCB.fields[k]) assert.equal(moved.fields[k].left_mm, layouts.ADCB.fields[k].left_mm + 4, `${k} moves with the date`);
});

test("a field key like 'constructor' cannot change the layout; the no-bearer mark can be moved even when the layout does not list it", () => {
  const moved = effectiveLayout(layouts.ADCB, { ...defaultCalibration(), offsets: { mmNoBearer: { left_mm: 1, top_mm: 1 }, constructor: { left_mm: 1, top_mm: 1 } } });
  assert.ok(moved.fields.mmNoBearer);
  assert.ok(!Object.hasOwn(moved.fields, "constructor"));
  assert.deepEqual(dragKeys("constructor"), ["constructor"]);
  assert.deepEqual(dragKeys("crossing"), ["lnPayee1", "lnPayee2"]);
});

test("Arabic name suggestions, batch rows, payee Arabic names and undo of a removed cheque", async () => {
  assert.equal(suggestArabic("Mohammed Ali Trading LLC"), "محمد علي للتجارة ذ.م.م");
  assert.equal(suggestArabic("Al Noor General Trading Co"), "شركة النور العامة للتجارة");
  const rows = parseBatch("Payee,Amount,Date\nAl Noor, 1,250.50, 15/11/2026\nGulf Star;3000\nX,abc\n,10", "2026-11-01");
  assert.deepEqual(rows.map((r) => [r.payee, r.amount, r.date, !!r.problem]), [["Al Noor", "1250.50", "2026-11-15", false], ["Gulf Star", "3000", "2026-11-01", false], ["X", "", "2026-11-01", true], ["", "10", "2026-11-01", true]]);

  const store = await memoryStore();
  const acc = await store.saveAccount({ name: "ADCB Main" });
  assert.deepEqual(await store.setPayeeArabic("Al Noor Trading", "النور للتجارة"), { "Al Noor Trading": "النور للتجارة" });
  assert.ok((await store.payees()).includes("Al Noor Trading"));
  await store.removePayee("Al Noor Trading");
  assert.deepEqual(await store.payeeArabic(), {});
  const added = await store.addCheque({ accountId: acc.id, chequeNo: "000001", payee: "A", amount: "5.00", currency: "AED", chequeDate: "2026-11-03", issuedOn: "2026-11-01", layoutId: "ADCB", wording: "", crossing: 1 });
  await store.setStatus(added.cheque.id, "cleared", { date: "2026-11-05" });
  const snapshot = await store.cheque(added.cheque.id);
  await store.deleteCheque(snapshot.id);
  assert.equal((await store.cheques()).length, 0);
  const back = await store.restoreCheque(snapshot);
  assert.equal(back.status, "cleared");
  assert.equal(back.statusDate, "2026-11-05");
  assert.equal(back.chequeNo, "000001");
  await assert.rejects(() => store.restoreCheque(snapshot), /already/);
});

test("a copy of the data is saved once a day, one file for each weekday", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-backup-"));
  try {
    const file = path.join(dir, "cheque_writer.db");
    let clock = new Date(2026, 10, 2, 9, 0); // a Monday
    const host = {
      platform: "win32", dataFile: file, now: () => clock,
      openDb: async (f, o) => nodeDb(f, o), runHelper: async () => ({ code: 0, out: "[]", err: "" }),
      savePdf: async () => null, pickOpen: async () => null, pickSave: async () => null, confirm: async () => true,
      removeFile: async (f) => fs.rmSync(f, { force: true }), openFolder: async () => null,
      about: async () => ({ version: "t", dataFolder: dir, portable: true, runtime: "t" }), replaceDataFile: async () => null, onNavigate: () => () => {},
    };
    const app = await createCore(host);
    await app.autoBackup();
    assert.ok(fs.existsSync(path.join(dir, "auto-backup-mon.db")));
    assert.equal((await app.invoke("state")).lastBackup, "2026-11-02");
    clock = new Date(2026, 10, 3, 9, 0);
    await app.autoBackup();
    assert.ok(fs.existsSync(path.join(dir, "auto-backup-tue.db")));
    const before = fs.statSync(path.join(dir, "auto-backup-tue.db")).mtimeMs;
    await app.autoBackup(); // the same day: nothing new
    assert.equal(fs.statSync(path.join(dir, "auto-backup-tue.db")).mtimeMs, before);
    app.stop();
  } finally {
    // Windows keeps the data file locked until the program ends; the folder is in the temp area, so a failed clean-up is harmless.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignored
    }
  }
});

test("window: each field drags alone, Arabic cheque, test print, batch, undo, help, big text and dark mode", async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { page } = h;
  await h.open();
  await page.getByText("Welcome to SJMR Cheque Writer").waitFor();
  await page.getByRole("tab", { name: "Banks & Layouts" }).click();
  await page.getByRole("button", { name: "Add bank account" }).click();
  await page.getByLabel("Account name").fill("ADCB Main");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Bank account saved.").waitFor();
  await page.getByRole("tab", { name: "Write & Print" }).click();
  await page.getByAltText("Cheque PDF preview").waitFor();
  await page.getByPlaceholder("Type a name or pick from the payee list").fill("Al Noor Trading");
  await page.getByLabel("Cheque amount").fill("1250.50");
  await page.waitForTimeout(700);

  // ---- drag one field: the date moves, nothing else does
  const x = (field) => page.locator(`rect[data-field="${field}"]`).first().getAttribute("x").then(Number);
  const box = (field) => page.locator(`rect[data-field="${field}"]`).first().boundingBox();
  const before = { date: await x("mmD1"), payee: await x("mmPayee"), amount: await x("mmAmount"), cross: await x("crossing") };
  const b = await box("mmD1");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 60, b.y + b.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.ok((await x("mmD1")) < before.date - 1, "the date moved left");
  assert.equal(await x("mmPayee"), before.payee, "the payee did not move");
  assert.equal(await x("mmAmount"), before.amount, "the amount did not move");
  assert.equal(await x("crossing"), before.cross, "the crossing did not move");
  // the payee alone
  const p = await box("mmPayee");
  const dateAfter = await x("mmD1");
  await page.mouse.move(p.x + 10, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + p.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.ok((await x("mmPayee")) > before.payee + 1, "the payee moved right");
  assert.equal(await x("mmD1"), dateAfter, "the date stayed where it was put");
  // the crossing lines move as one field and the "XXXXXX" mark moves alone
  const c = await box("crossing");
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 30, c.y + c.height / 2 + 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.notEqual(await x("crossing"), before.cross, "the crossing moved");
  assert.equal(await x("mmAmount"), before.amount, "still the amount did not move");
  await h.shot("10-drag");

  // ---- arrow buttons move one part each
  const before2 = { date: await x("mmD1"), payee: await x("mmPayee"), amount: await x("mmAmount"), cross: await x("crossing") };
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Move date right", exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok((await x("mmD1")) > before2.date + 1, "the date moved right with its arrow");
  assert.equal(await x("mmPayee"), before2.payee);
  assert.equal(await x("mmAmount"), before2.amount);
  assert.equal(await x("crossing"), before2.cross);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Move crossing left", exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok((await x("crossing")) < before2.cross - 1, "the crossing moved left with its arrow");
  // Reset crossing: every move of the two lines is taken back, nothing else moves
  const dateNow = await x("mmD1");
  await page.getByRole("button", { name: "Reset crossing", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await x("crossing"), before.cross, "Reset crossing put the crossing back where the layout has it");
  assert.equal(await x("mmD1"), dateNow, "the date did not move with the reset");
  const amountBefore = await x("mmAmount");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Move amount left", exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok((await x("mmAmount")) < amountBefore - 1, "the amount moved with its arrow");
  for (const part of ["payee", "words"]) await page.getByRole("button", { name: `Move ${part} up`, exact: true }).click();
  // cross only: the two lines stay, the stamp text goes
  await page.getByLabel("Security crossing").selectOption("4");
  await page.waitForTimeout(700);
  assert.ok(await page.locator('rect[data-field="crossing"]').count(), "the two lines are still there");
  await h.shot("10b-cross-only");

  // ---- Arabic cheque
  await page.getByLabel("Cheque language").selectOption("ar");
  await page.getByLabel("Payee name in Arabic").waitFor();
  await page.getByRole("button", { name: "Suggest" }).click();
  assert.match(await page.getByLabel("Payee name in Arabic").inputValue(), /النور/);
  await page.waitForTimeout(900);
  await h.shot("11-arabic");
  await page.getByLabel(/Show advanced options/).check();
  assert.equal(await page.getByLabel(/Lock the crossing lines together/).isChecked(), true, "the crossing is locked by default");
  await page.getByRole("button", { name: "Cheque PDF" }).click();
  await page.getByText(/Cheque PDF saved/).waitFor();
  // the form clears itself after the saved cheque: wait for that before typing the next one
  await page.waitForFunction(() => document.querySelector('input[aria-label="Payee name in Arabic"]').value === "" && document.querySelector('input[aria-label="Cheque amount"]').value === "");
  const pdf = Buffer.from(h.savedData.at(-1), "base64");
  assert.ok(pdf.includes("FontFile2"), "the PDF carries the Arabic font");
  assert.equal((await h.store.cheques()).length, 1, "a saved PDF is listed like a printed cheque when 'Add cheque to list' is ticked");
  // printed and listed: the Arabic name is kept with the English payee (the form was cleared by the PDF, fill it again)
  await page.getByPlaceholder("Type a name or pick from the payee list").fill("Al Noor Trading");
  await page.getByLabel("Cheque amount").fill("1250.50");
  await page.getByRole("button", { name: "Suggest" }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Print cheque" }).click();
  await page.getByText(/Added to the cheque list|updated/).waitFor({ timeout: 8000 }).catch(async () => { throw new Error("print failed: " + (await page.locator("main").innerText()).slice(0, 600)); });
  assert.deepEqual(await h.store.payeeArabic(), { "Al Noor Trading": "النور للتجارة" });
  assert.equal((await h.store.cheques())[0].payee.includes("النور"), true);
  // the typing boxes are empty and ready for the next cheque
  await page.waitForFunction(() => document.querySelector('input[aria-label="Payee name in Arabic"]').value === "");
  await page.getByLabel("Cheque language").selectOption("en");

  // ---- test print: outline, nothing listed
  const listed = (await h.store.cheques()).length;
  const sentBefore = h.sent.length;
  await page.getByRole("button", { name: "Test print" }).click();
  await page.getByText(/Test sheet sent to the printer/).waitFor();
  assert.equal(h.sent.length, sentBefore + 1);
  const job = JSON.parse(h.sent.at(-1).job);
  assert.ok(job.lines.length >= 4 + 2, "the cheque outline (4 lines) is added to the crossing lines");
  assert.equal((await h.store.cheques()).length, listed, "a test print is not listed");

  // ---- batch printing stops at the first problem and prints the rest in order
  await page.getByRole("tab", { name: "Batch" }).click();
  await page.getByLabel("Batch cheques").fill("Al Noor, 100, 15/11/2026\nGulf Star, 200.50, 16/11/2026");
  await page.waitForFunction(() => document.querySelector('input[aria-label="First cheque number"]')?.value === "000003");
  await page.getByLabel("First cheque number").fill("000100");
  await page.getByRole("button", { name: "Print 2 cheques" }).click();
  await page.waitForTimeout(1500);
  await h.shot("13-batch");
  await page.getByText("Printed as 000101").waitFor({ timeout: 8000 }).catch(async () => { throw new Error("batch failed: " + JSON.stringify(h.errors) + (await page.locator("main").innerText()).slice(-300)); });
  assert.equal((await h.store.cheques()).length, listed + 2);
  assert.deepEqual((await h.store.cheques()).map((c) => c.chequeNo).filter((n) => /^0001/.test(n)).sort(), ["000100", "000101"]);

  // ---- cheque list: undo, report, reprint
  await page.getByRole("tab", { name: /Cheque List/ }).click();
  await page.getByRole("row", { name: /000100/ }).getByRole("button", { name: "Cleared" }).click();
  await page.getByRole("button", { name: "Mark cleared", exact: true }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Undone.").waitFor();
  assert.equal((await h.store.cheques()).find((c) => c.chequeNo === "000100").status, "pending");
  await page.evaluate(() => {
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = (node) => {
      if (node instanceof HTMLIFrameElement) window.__frame = node;
      return append(node);
    };
  });
  await page.getByRole("button", { name: "Print list" }).click();
  await page.waitForFunction(() => window.__frame?.contentDocument?.body?.innerText.includes("Totals by Status"));
  const report = await page.evaluate(() => window.__frame.contentDocument.body.innerText);
  assert.match(report, /Totals by Bank/);
  assert.match(report, /Totals by Month/);
  assert.match(report, /000101/);
  const sentReprint = h.sent.length;
  await page.getByRole("row", { name: /000100/ }).getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Reprint" }).click();
  await page.getByText("Cheque 000100 printed again.").waitFor();
  assert.equal(h.sent.length, sentReprint + 1);
  // remove and undo
  await page.getByRole("row", { name: /000101/ }).getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await page.getByRole("button", { name: "Yes, remove from list" }).click();
  await page.getByText("Cheque 000101 removed from the list.").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("cell", { name: "000101", exact: true }).waitFor();

  // ---- payees tab shows the Arabic name; help; text size and dark mode
  await page.getByRole("tab", { name: "Payees" }).click();
  await page.getByText("النور للتجارة").waitFor();
  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Help" }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Text size").selectOption("xlarge");
  assert.equal(await page.evaluate(() => document.documentElement.style.zoom), "1.3");
  await page.getByLabel("Colours").selectOption("dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await h.shot("12-dark");
  assert.deepEqual(h.errors, []);
});
