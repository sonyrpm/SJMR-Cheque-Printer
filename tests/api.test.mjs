import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createApi } from "../core/api.mjs";
import { createChequeEngine } from "../core/engine.mjs";
import { memoryStore, openNodeDb } from "./helpers/node-host.mjs";

const layouts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../shared/bank-layouts.json"), "utf8"));
const calibration = { CCAC_CHEQUE_WIDTH: 201.8, CCAC_CHEQUE_HEIGHT: 100.9, CCAC_FONT_SIZE: 12.5, CCAC_SCALE_PCT: 100, CCAC_WRAP_CHARS: 40, CCAC_PRINTER_OFFSET_X: 5, CCAC_PRINTER_OFFSET_Y: 2, CCAC_LINE_SPACING: 0, CCAC_SHIFT_AC_PAYEE: 0 };
const request = (over = {}) => ({
  template: layouts.ADCB,
  account: { ...calibration, CCAC_NAME: "ADCB Main", CCAC_NO: "123", CCAC_PRINTER_NAME: "HP", CCAC_PRINTER_TRAY: "Tray 1", CCAC_ORIENTATION: "Landscape" },
  cheque: { CCT_PAYEE: "AL NOOR TRADING", CCT_AMOUNT: "1250.50", CCT_CURRENCY: "AED", CCT_DATE: "2026-11-10", CCT_CHEQUE_NO: "000101", CCT_CROSSING_OPTION: 1, CCT_AC_PAYEE_ONLY: "Y", CCT_WORDING: null },
  ...over,
});
function fakeHelper(outputs) {
  const calls = [];
  const runHelper = async ({ args, job }) => {
    calls.push({ args, job });
    const out = outputs.shift();
    if (out instanceof Error) throw out;
    return { code: 0, out: out ?? "", err: "" };
  };
  return { runHelper, calls };
}
async function setup(outputs = [], { pdfTarget = "C:/x/cheque.pdf" } = {}) {
  const store = await memoryStore();
  const account = await store.saveAccount({ name: "ADCB Main" });
  const { runHelper, calls } = fakeHelper(outputs);
  const engine = createChequeEngine({ platform: "win32", runHelper });
  const saved = [];
  const api = createApi({ store, engine, openDb: openNodeDb, savePdf: async (base64, name) => (pdfTarget ? (saved.push({ buffer: Buffer.from(base64, "base64"), name }), pdfTarget) : null), now: () => new Date(2026, 10, 1, 9, 0) });
  return { store, account, api, calls, saved };
}

test("Print directly with 'Add cheque to list' ticked: printed first, then listed as pending", async () => {
  const { api, store, account, calls } = await setup(["PRINTED_OK|HP|Tray 1|Landscape"]);
  const result = await api.output({ action: "direct", request: request(), list: { accountId: account.id, layoutId: "ADCB" } });
  assert.equal(result.ok, true);
  assert.match(result.message, /sent to the printer\. Added to the cheque list/);
  assert.equal(calls.length, 1);
  const rows = await store.cheques();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].chequeNo, rows[0].payee, rows[0].amount, rows[0].status, rows[0].chequeDate, rows[0].issuedOn], ["000101", "AL NOOR TRADING", "1250.50", "pending", "2026-11-10", "2026-11-01"]);
  assert.match(rows[0].wording, /Thousand/);
});

test("Unticked: the cheque is only printed, nothing is listed", async () => {
  const { api, store, calls } = await setup(["PRINTED_OK|HP|Tray 1|Landscape"]);
  const result = await api.output({ action: "direct", request: request(), list: null });
  assert.equal(result.saved, null);
  assert.equal(calls.length, 1);
  assert.equal((await store.cheques()).length, 0);
});

test("A cancelled print dialog or a printer error lists nothing", async () => {
  const { api, store, account } = await setup(["CANCELLED", "no paper"]);
  const cancelled = await api.output({ action: "dialog", request: request(), list: { accountId: account.id, layoutId: "ADCB" } });
  assert.equal(cancelled.cancelled, true);
  await assert.rejects(api.output({ action: "direct", request: request(), list: { accountId: account.id, layoutId: "ADCB" } }), /no paper|printer/i);
  assert.equal((await store.cheques()).length, 0);
});

test("A cleared number is refused BEFORE printing, so no leaf is wasted", async () => {
  const { api, store, account, calls } = await setup(["PRINTED_OK|HP|Tray 1|Landscape"]);
  const { cheque } = await store.addCheque({ accountId: account.id, chequeNo: "000101", payee: "X", amount: "5.00", currency: "AED", chequeDate: "2026-11-02", issuedOn: "2026-11-01", layoutId: "", wording: "", crossing: 1 });
  await store.setStatus(cheque.id, "cleared", { date: "2026-11-03" });
  await assert.rejects(api.output({ action: "direct", request: request(), list: { accountId: account.id, layoutId: "ADCB" } }), /already cleared/);
  assert.equal(calls.length, 0, "nothing was sent to the printer");
  const unticked = await api.output({ action: "direct", request: request(), list: null });
  assert.equal(unticked.ok, true, "the same number can still be printed when not listed");
});

test("Printed but not saved: the print stands and the list error is reported", async () => {
  const { api, store, account } = await setup(["PRINTED_OK|HP|Tray 1|Landscape"]);
  await store.deleteAccount(account.id);
  const result = await api.output({ action: "direct", request: request(), list: { accountId: account.id, layoutId: "ADCB" } });
  assert.equal(result.ok, true);
  assert.match(result.listError, /bank account/);
});

test("PDF goes through the save dialog; a cancelled dialog lists nothing", async () => {
  const a = await setup();
  const done = await a.api.output({ action: "pdf", request: request(), list: { accountId: a.account.id, layoutId: "ADCB" } });
  assert.match(done.message, /PDF saved/);
  assert.equal(a.saved[0].name, "Cheque-000101.pdf");
  assert.equal(a.saved[0].buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await a.store.cheques()).length, 1);
  const b = await setup([], { pdfTarget: null });
  const none = await b.api.output({ action: "pdf", request: request(), list: { accountId: b.account.id, layoutId: "ADCB" } });
  assert.equal(none.cancelled, true);
  assert.equal((await b.store.cheques()).length, 0);
});

test("Printing the same pending number again updates the list entry", async () => {
  const { api, store, account } = await setup(["PRINTED_OK|HP|T|L", "PRINTED_OK|HP|T|L"]);
  await api.output({ action: "direct", request: request(), list: { accountId: account.id, layoutId: "ADCB" } });
  const again = await api.output({ action: "direct", request: request({ cheque: { ...request().cheque, CCT_PAYEE: "NEW PAYEE" } }), list: { accountId: account.id, layoutId: "ADCB" } });
  assert.match(again.message, /updated/);
  assert.equal((await store.cheques()).length, 1);
  assert.equal((await store.cheques())[0].payee, "NEW PAYEE");
});

test("state, alerts and settings through the api", async () => {
  const { api, account, store } = await setup();
  await store.addCheque({ accountId: account.id, chequeNo: "1", payee: "P", amount: "1.00", currency: "AED", chequeDate: "2026-11-02", issuedOn: "2026-11-01", layoutId: "", wording: "", crossing: 1 });
  const state = await api.state();
  assert.equal(state.today, "2026-11-01");
  assert.equal(Object.keys(state.config.layouts).length, 42);
  const alerts = await api.alerts();
  assert.equal(alerts.summary.soon.length, 1);
  let hooked = null;
  const hooks = createApi({ store, engine: null, openDb: openNodeDb, hooks: { onAlertSettings: (v) => (hooked = v) } });
  await hooks.saveAlerts({ daysAhead: 7 });
  assert.equal(hooked.daysAhead, 7);
  assert.equal((await store.alerts()).daysAhead, 7);
});
