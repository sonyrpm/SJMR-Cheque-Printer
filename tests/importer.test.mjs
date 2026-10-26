import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { memoryStore, openNodeDb } from "./helpers/node-host.mjs";
import { importOldRegister } from "../core/importer.mjs";

const OLD = path.join(import.meta.dirname, "fixtures", "old-register.db");

test("the old register is imported: accounts, calibration, layouts, cheque statuses, payees", async () => {
  const store = await memoryStore();
  const report = await importOldRegister(store, openNodeDb, OLD);
  assert.equal(report.accounts, 3, "the two test accounts and the account the old app seeds itself");
  assert.equal(report.cheques, 5, "deleted and ledger rows are not cheques");
  assert.equal(report.ledgerEntries, 1);
  assert.equal(report.layouts, 1);
  assert.deepEqual(report.warnings, []);
  const accounts = await store.accounts();
  const adcb = accounts.find((a) => a.name === "ADCB Main");
  assert.equal(adcb.bankNo, "AE07 0330 0000 1111");
  const config = await store.config();
  const cal = config.banks[adcb.id].calibration.ADCB;
  assert.deepEqual([cal.x, cal.y, cal.font, cal.wrap, cal.printer, cal.tray], [5, 2, 12.5, 40, "HP LaserJet", "Tray 1"]);
  assert.deepEqual(cal.offsets.mmPayee, { left_mm: 1.5, top_mm: -0.5 });
  assert.equal(cal.text.long_payee, "wrap");
  assert.equal(cal.text.amount_prefix, "#");
  assert.equal(cal.text.no_trailing_zeros, false);
  assert.equal(config.banks[adcb.id].layoutId, "ADCB");
  const fab = accounts.find((a) => a.name === "FAB Current");
  assert.equal(fab.currency, "USD");
  assert.equal(config.banks[fab.id].layoutId, "MYBANK", "custom layout and its account assignment");
  assert.equal(config.layouts.MYBANK.display_name, "My Local Bank");
  const by = Object.fromEntries((await store.cheques({}, "2026-11-01")).map((c) => [c.chequeNo, c]));
  assert.equal(by["000101"].status, "cleared");
  assert.equal(by["000101"].statusDate, "2026-10-22");
  assert.equal(by["000101"].note, "rent");
  assert.equal(by["000101"].amount, "1250.50");
  assert.equal(by["000102"].status, "pending");
  assert.equal(by["000103"].status, "cancelled");
  assert.equal(by["000104"].chequeDate, null);
  assert.equal(by["000201"].currency, "USD");
  assert.equal(by["000105"], undefined, "the deleted cheque stays deleted");
  assert.deepEqual((await store.payees()).filter((p) => ["Beta LLC", "Extra Payee One"].includes(p)), ["Beta LLC", "Extra Payee One"]);
  assert.equal((await store.history(by["000102"].id))[0].action, "imported");
});

test("importing the same file twice adds nothing new", async () => {
  const store = await memoryStore();
  await importOldRegister(store, openNodeDb, OLD);
  const again = await importOldRegister(store, openNodeDb, OLD);
  assert.equal(again.accounts, 0);
  assert.equal(again.accountsReused, 3);
  assert.equal(again.cheques, 0);
  assert.equal(again.chequesSkipped, 5);
  assert.equal((await store.cheques()).length, 5);
});

test("a wrong file is refused and the old file is not changed", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-imp-"));
  try {
    fs.writeFileSync(path.join(dir, "x.db"), "nope");
    await assert.rejects(async () => await importOldRegister(await memoryStore(), openNodeDb, path.join(dir, "x.db")), /not an old Cheque Printer/);
    await assert.rejects(async () => await importOldRegister(await memoryStore(), openNodeDb, path.join(dir, "missing.db")), /not an old Cheque Printer/);
    const before = fs.readFileSync(OLD);
    await importOldRegister(await memoryStore(), openNodeDb, OLD);
    assert.ok(before.equals(fs.readFileSync(OLD)), "read-only");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
