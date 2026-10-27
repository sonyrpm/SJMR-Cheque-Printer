import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { SceneCanvas, renderChequeFields, prepare } from "../shared/cheque-core.mjs";

const BANK_LAYOUTS = JSON.parse(fs.readFileSync(new URL("../shared/bank-layouts.json", import.meta.url), "utf8"));
const { crossingLocked, crossingMove, crossingStart, defaultCalibration, effectiveLayout, engineRequest, moveFields, resetCrossing, validateCalibration } = await import("../src/lib/cheque-writer-model.ts");

const CROSSING = ["lnPayee1", "lnPayee2"];
const values = { number: "000123", payee: "Example", amount: "10", date: "2026-10-26", blankDate: false, crossed: true, crossing: 1, noBearer: false, payeeCaps: false, style: "standard", wording: null };

function crossingItems(cal, move = crossingMove(cal)) {
  const canvas = new SceneCanvas(201.8, 100.9);
  const template = effectiveLayout(BANK_LAYOUTS.ADCB, cal);
  renderChequeFields(canvas, template, { CCT_PAYEE: "X", CCT_AMOUNT: "1", CCT_CURRENCY: "AED", CCT_CROSSING_OPTION: 1, CCT_AC_PAYEE_ONLY: "Y" }, 0, 0, 0, 12.5, 100, 40, 0, null, move);
  return canvas.items.filter((item) => item.tag === "crossing");
}
const shape = (items) => items.map((i) => (i.k === "line" ? [Math.hypot(i.x2 - i.x1, i.y2 - i.y1), Math.atan2(i.y1 - i.y2, i.x2 - i.x1)] : [i.rot])).flat().map((n) => Math.round(n * 1e6) / 1e6);
const moved = (cal, dx, dy) => moveFields(cal, CROSSING, dx, dy);

test("the crossing is locked by default and old saved settings read as locked", () => {
  assert.equal(defaultCalibration("ADCB").crossingLock, true);
  const old = { ...defaultCalibration("ADCB") };
  delete old.crossingLock;
  assert.equal(crossingLocked(old), true);
  assert.equal(validateCalibration(old).crossingLock, undefined);
  assert.throws(() => validateCalibration({ ...old, crossingLock: "yes" }), /crossing/i);
});

test("locked: moving the crossing in any direction keeps the shape of the lines and the angle of the text", () => {
  const base = shape(crossingItems(defaultCalibration("ADCB")));
  for (const [dx, dy] of [[0, 5], [0, -2], [0, -5], [-3, 0], [5, 0], [-4, -4], [6, 6]]) {
    const cal = moved(defaultCalibration("ADCB"), dx, dy);
    assert.deepEqual(shape(crossingItems(cal)), base, `move ${dx},${dy}`);
  }
});

test("locked: every point of the crossing (both lines and the text) moves by exactly the same distance", () => {
  const start = crossingItems(defaultCalibration("ADCB"));
  const end = crossingItems(moved(defaultCalibration("ADCB"), 4, -3));
  assert.equal(start.length, end.length);
  start.forEach((a, i) => {
    const b = end[i];
    if (a.k === "line") {
      assert.ok(Math.abs(b.x1 - a.x1 - 4) < 1e-9 && Math.abs(b.y1 - a.y1 + 3) < 1e-9);
      assert.ok(Math.abs(b.x2 - a.x2 - 4) < 1e-9 && Math.abs(b.y2 - a.y2 + 3) < 1e-9);
    } else {
      assert.ok(Math.abs(b.x - a.x - 4) < 1e-9 && Math.abs(b.y - a.y + 3) < 1e-9);
    }
  });
});

test("unlocked: the lines follow their own layout numbers as before (this is why the lock exists)", () => {
  const base = shape(crossingItems({ ...defaultCalibration("ADCB"), crossingLock: false }));
  const cal = { ...moved(defaultCalibration("ADCB"), 0, -5), crossingLock: false };
  assert.notDeepEqual(shape(crossingItems(cal)), base);
});

test("Reset crossing puts the lines back and touches nothing else", () => {
  let cal = moveFields(defaultCalibration("ADCB"), ["lnPayee1", "lnPayee2", "mmPayee"], 3, 2);
  cal = resetCrossing(cal);
  assert.equal(cal.offsets.lnPayee1, undefined);
  assert.equal(cal.offsets.lnPayee2, undefined);
  assert.deepEqual(cal.offsets.mmPayee, { left_mm: 3, top_mm: 2 });
  assert.deepEqual(crossingMove(cal), { dx: 0, dy: 0 });
  assert.deepEqual(shape(crossingItems(cal)), shape(crossingItems(defaultCalibration("ADCB"))));
});

test("the engine request carries the crossing move and the engine accepts only sane numbers", () => {
  const cal = moved(defaultCalibration("ADCB"), 2.5, -1);
  const request = engineRequest(BANK_LAYOUTS.ADCB, cal, values, { id: "ADCB", code: "", name: "ADCB", bankNo: "1" }, "AED");
  assert.equal(request.account.CCAC_CROSS_DX, 2.5);
  assert.equal(request.account.CCAC_CROSS_DY, -1);
  assert.equal(request.template.fields.lnPayee1.left_mm, BANK_LAYOUTS.ADCB.fields.lnPayee1.left_mm);
  assert.doesNotThrow(() => prepare({ ...request, action: "preview" }));
  assert.throws(() => prepare({ ...request, action: "preview", account: { ...request.account, CCAC_CROSS_DX: 900 } }), /CCAC_CROSS_DX/);
  const unlocked = engineRequest(BANK_LAYOUTS.ADCB, { ...cal, crossingLock: false }, values, { id: "ADCB", code: "", name: "ADCB", bankNo: "1" }, "AED");
  assert.equal(unlocked.account.CCAC_CROSS_DX, 0);
  assert.equal(unlocked.template.fields.lnPayee1.left_mm, BANK_LAYOUTS.ADCB.fields.lnPayee1.left_mm + 2.5);
});

test("a cheque with no move prints exactly as before (golden files stay valid)", () => {
  const items = crossingItems(defaultCalibration("ADCB"));
  const first = items.find((i) => i.k === "line");
  assert.equal(first.x1, 0);
  assert.equal(first.y1, 18.9);
});

test("a new cheque starts with CROSS ONLY, and a bank account keeps the crossing choice it was saved with", () => {
  const fresh = defaultCalibration("ADCB");
  assert.deepEqual(crossingStart(fresh), { crossed: true, crossing: 4, noBearer: false });
  const kept = validateCalibration({ ...fresh, crossingDefaults: { crossed: false, crossing: 2, noBearer: true, extra: 1 } });
  assert.deepEqual(kept.crossingDefaults, { crossed: false, crossing: 2, noBearer: true });
  assert.deepEqual(crossingStart(kept), { crossed: false, crossing: 2, noBearer: true });
  for (const bad of [{ crossed: "yes", crossing: 1, noBearer: false }, { crossed: true, crossing: 9, noBearer: false }, { crossed: true, crossing: 1 }, null])
    assert.throws(() => validateCalibration({ ...fresh, crossingDefaults: bad }), /crossing/i);
});
