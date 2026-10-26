import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChequeStore, checkDataFile } from "../core/store.mjs";
import { memoryStore, openNodeDb } from "./helpers/node-host.mjs";
import { alertSummary, chequeFromPrint, checkStatusChange, daysBetween, dueInfo, filterCheques, DEFAULT_ALERTS } from "../shared/cheque-rules.mjs";

const values = (over = {}) => ({ number: "000101", payee: "Al Noor Trading", amount: "1,250.50", date: "2026-11-10", blankDate: false, crossed: true, crossing: 1, payeeCaps: true, ...over });
async function fresh() {
  const store = await memoryStore();
  const account = await store.saveAccount({ name: "ADCB Main", bankNo: "AE07 0330 1111", currency: "AED" });
  return { store, account };
}
const rec = (account, over = {}, today = "2026-11-01") => chequeFromPrint({ accountId: account.id, values: values(over), currency: "AED", layoutId: "ADCB", wording: "One Thousand", today });

test("date helpers and due classification", async () => {
  assert.equal(daysBetween("2026-11-01", "2026-11-10"), 9);
  const c = (date, status = "pending") => ({ status, chequeDate: date });
  assert.equal(dueInfo(c("2026-11-01"), "2026-11-01").kind, "today");
  assert.equal(dueInfo(c("2026-11-03"), "2026-11-01").kind, "soon");
  assert.equal(dueInfo(c("2026-11-04"), "2026-11-01").kind, "soon");
  assert.equal(dueInfo(c("2026-11-05"), "2026-11-01").kind, "later");
  assert.equal(dueInfo(c("2026-10-30"), "2026-11-01").kind, "recent");
  assert.equal(dueInfo(c("2026-10-20"), "2026-11-01").kind, "overdue");
  assert.equal(dueInfo(c(null), "2026-11-01").kind, "none");
  assert.equal(dueInfo(c("2026-10-01", "cleared"), "2026-11-01").kind, "none", "cleared and returned cheques are never due");
});

test("a printed cheque becomes one pending record; the same number again is a reprint, not a duplicate", async () => {
  const { store, account } = await fresh();
  const first = await store.addCheque(rec(account));
  assert.equal(first.cheque.status, "pending");
  assert.equal(first.cheque.payee, "AL NOOR TRADING");
  assert.equal(first.cheque.amount, "1250.50");
  const again = await store.addCheque(rec(account, { payee: "Other Co", amount: "99" }));
  assert.equal(again.updated, true);
  assert.equal((await store.cheques()).length, 1);
  assert.equal((await store.cheques())[0].payee, "OTHER CO");
  assert.deepEqual((await store.history(first.cheque.id)).map((h) => h.action), ["added", "printed again"]);
});

test("a cleared or returned number cannot be listed again, and the check runs before printing", async () => {
  const { store, account } = await fresh();
  const { cheque } = await store.addCheque(rec(account));
  await store.setStatus(cheque.id, "cleared", { date: "2026-11-05" });
  await assert.rejects(async () => await store.checkAddable(account.id, "000101"), /already cleared.*untick "Add cheque to list"/);
  await assert.rejects(async () => await store.addCheque(rec(account)), /already cleared/);
  assert.equal((await store.checkAddable(account.id, "000102")).exists, false);
});

test("status marks: cleared, returned needs a reason, reopen, history is kept", async () => {
  const { store, account } = await fresh();
  const { cheque } = await store.addCheque(rec(account));
  await assert.rejects(async () => await store.setStatus(cheque.id, "returned", { date: "2026-11-12" }), /reason/);
  const returned = await store.setStatus(cheque.id, "returned", { date: "2026-11-12", reason: "Insufficient funds" });
  assert.equal(returned.status, "returned");
  assert.equal(returned.reason, "Insufficient funds");
  await assert.rejects(async () => await store.setStatus(cheque.id, "returned", { date: "2026-11-12", reason: "Insufficient funds" }), /already returned/);
  await assert.rejects(async () => await store.setStatus(cheque.id, "cleared", { date: "2026-13-40" }), /YYYY-MM-DD/);
  const back = await store.setStatus(cheque.id, "pending");
  assert.deepEqual([back.status, back.statusDate, back.reason], ["pending", null, ""]);
  assert.deepEqual((await store.history(cheque.id)).map((h) => h.to_status), ["pending", "returned", "pending"]);
  await assert.rejects(async () => await store.setStatus("nope", "cleared"), /no longer/);
});

test("bulk status is all or nothing", async () => {
  const { store, account } = await fresh();
  const ids = [];
  for (const n of ["000101", "000102", "000103"]) ids.push((await store.addCheque(rec(account, { number: n }))).cheque.id);
  await store.setStatus(ids[2], "cleared", { date: "2026-11-02" });
  await assert.rejects(async () => await store.setStatusMany(ids, "cleared", { date: "2026-11-02" }), /already cleared/);
  assert.deepEqual((await store.cheques({ status: "cleared" })).map((c) => c.id), [ids[2]], "nothing else changed");
  assert.equal((await store.setStatusMany(ids.slice(0, 2), "cleared", { date: "2026-11-03" })).length, 2);
});

test("coming, attention and search filters", async () => {
  const { store, account } = await fresh();
  const add = async (n, date, over = {}) => (await store.addCheque(rec(account, { number: n, date, blankDate: date === null, ...over }, "2026-11-01"))).cheque;
  const a = await add("1", "2026-11-02"), b = await add("2", "2026-11-20"), c = await add("3", "2026-10-10"), d = await add("4", null, { payee: "Blank Date Co" });
  await store.setStatus(b.id, "cleared", { date: "2026-11-20" });
  const names = async (f) => (await store.cheques(f, "2026-11-01")).map((x) => x.chequeNo);
  assert.deepEqual(await names({ status: "coming" }), ["1"]);
  assert.deepEqual((await names({ status: "attention" })).sort(), ["1", "3"]);
  assert.deepEqual((await names({ status: "pending" })).sort(), ["1", "3", "4"]);
  assert.deepEqual(await names({ q: "blank date" }), ["4"]);
  assert.deepEqual(await names({ from: "2026-11-01", to: "2026-11-30" }), ["1", "2"]);
  assert.ok(a && c && d);
});

test("alerts: summary, one Windows notice per cheque per day", async () => {
  const { store, account } = await fresh();
  for (const [n, date] of [["1", "2026-11-01"], ["2", "2026-11-03"], ["3", "2026-10-10"], ["4", "2026-12-25"]])
    await store.addCheque(rec(account, { number: n, date }));
  const s = await store.alertSummary("2026-11-01");
  assert.deepEqual([s.today.length, s.soon.length, s.overdue.length, s.count], [1, 1, 1, 3]);
  const first = await store.unseenAlerts("2026-11-01");
  assert.equal(first.count, 3);
  await store.markSeen(first, "2026-11-01");
  assert.equal((await store.unseenAlerts("2026-11-01")).count, 0);
  assert.equal((await store.unseenAlerts("2026-11-02")).count, 2, "announced again the next day (the cheque dated yesterday is not yet overdue)");
  await store.saveAlerts({ ...DEFAULT_ALERTS, enabled: false });
  assert.equal((await store.alertSummary("2026-11-01")).count, 0);
  await assert.rejects(async () => await store.saveAlerts({ daysAhead: -1 }), /whole number/);
});

test("accounts: duplicates, currency lock, delete rules and design cleanup", async () => {
  const { store, account } = await fresh();
  await assert.rejects(async () => await store.saveAccount({ name: "adcb main" }), /already exists/);
  await store.addCheque(rec(account));
  await assert.rejects(async () => await store.saveAccount({ id: account.id, name: "ADCB Main", currency: "USD" }), /currency cannot change/);
  await assert.rejects(async () => await store.deleteAccount(account.id), /inactive/);
  const other = await store.saveAccount({ name: "FAB" });
  const config = await store.config();
  await store.saveDesign({ kind: "calibration", revision: config.revision, bankId: other.id, layoutId: "ADCB", calibration: { width: 201.8 } });
  assert.ok((await store.config()).banks[other.id]);
  await store.deleteAccount(other.id);
  assert.equal((await store.config()).banks[other.id], undefined);
});

test("design: stale revision, reserved ids, assigned layout cannot be deleted", async () => {
  const { store, account } = await fresh();
  const rev = (await store.config()).revision;
  const layout = structuredClone((await store.config()).layouts.ADCB);
  layout.id = "MINE";
  layout.display_name = "My Bank";
  const saved = await store.saveDesign({ kind: "layouts", revision: rev, layouts: { MINE: layout }, replace: false });
  assert.equal(saved.revision, rev + 1);
  await assert.rejects(async () => await store.saveDesign({ kind: "layouts", revision: rev, layouts: { MINE: layout } }), /changed/);
  await assert.rejects(async () => await store.saveDesign({ kind: "layouts", revision: saved.revision, layouts: { constructor: { ...layout, id: "constructor", display_name: "x" } } }), /reserved/);
  await store.saveDesign({ kind: "calibration", revision: saved.revision, bankId: account.id, layoutId: "MINE", calibration: { width: 200 } });
  await assert.rejects(async () => await store.saveDesign({ kind: "delete", revision: (await store.config()).revision, id: "MINE" }), /assigned/);
});

test("payees: add, import counts only new names, replace", async () => {
  const { store } = await fresh();
  await store.addPayee("Beta LLC");
  assert.equal(await store.importPayees(["beta llc", "Alpha", " Alpha "]), 1);
  assert.deepEqual(await store.payees(), ["Alpha", "Beta LLC"]);
  await assert.rejects(async () => await store.addPayee("bad\u0001name"), /control/);
  assert.deepEqual(await store.replacePayees(["Z"]), ["Z"]);
});

test("next cheque number follows the highest number in the list", async () => {
  const { store, account } = await fresh();
  assert.equal(await store.nextChequeNo(account.id), null);
  for (const n of ["000099", "000101", "ABC"]) await store.addCheque(rec(account, { number: n }));
  assert.equal(await store.nextChequeNo(account.id), "000102");
});

test("the data file can be copied and a foreign file is refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-"));
  try {
    const store = await ChequeStore.open(await openNodeDb(path.join(dir, "a.db")), path.join(dir, "a.db"));
    const account = await store.saveAccount({ name: "X" });
    await store.addCheque(rec(account));
    await store.backupTo(path.join(dir, "copy.db"));
    await checkDataFile(openNodeDb, path.join(dir, "copy.db"));
    const copy = await ChequeStore.open(await openNodeDb(path.join(dir, "copy.db")), path.join(dir, "copy.db"));
    assert.equal((await copy.summary()).cheques, 1);
    await copy.close();
    await store.close();
    fs.writeFileSync(path.join(dir, "bad.db"), "not sqlite");
    await assert.rejects(async () => await checkDataFile(openNodeDb, path.join(dir, "bad.db")), /not a SJMR Cheque Writer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chequeFromPrint refuses empty or bad input", async () => {
  const a = { id: "x" };
  assert.throws(() => rec(a, { number: " " }), /cheque number/);
  assert.throws(() => rec(a, { payee: "" }), /payee/);
  assert.throws(() => rec(a, { amount: "0" }), /positive/);
  assert.throws(() => rec(a, { date: "2026-02-30" }), /YYYY-MM-DD/);
  assert.equal(rec(a, { blankDate: true }).chequeDate, null);
});
