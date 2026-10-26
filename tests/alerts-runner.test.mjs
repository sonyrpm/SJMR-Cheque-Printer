import assert from "node:assert/strict";
import test from "node:test";
import { memoryStore, openNodeDb } from "./helpers/node-host.mjs";
import { runAlertRound } from "../core/alerts.mjs";

async function setup() {
  const store = await memoryStore();
  const account = await store.saveAccount({ name: "A" });
  const add = async (no, date) => await store.addCheque({ accountId: account.id, chequeNo: no, payee: "P", amount: "1.00", currency: "AED", chequeDate: date, issuedOn: "2026-11-01", layoutId: "", wording: "", crossing: 1 });
  return { store, add };
}
test("one Windows notice per cheque per day, with plain text", async () => {
  const { store, add } = await setup();
  await add("1", "2026-11-01");
  await add("2", "2026-11-03");
  await add("3", "2026-10-01");
  const shown = [];
  const notify = (title, body) => shown.push([title, body]);
  assert.equal((await runAlertRound({ store, notify, today: "2026-11-01" })).count, 3);
  assert.deepEqual(shown, [["SJMR Cheque Writer", "1 due today, 1 coming soon, 1 not cleared after the cheque date"]]);
  assert.equal(await runAlertRound({ store, notify, today: "2026-11-01" }), null, "same day: nothing again");
  assert.equal(shown.length, 1);
  await add("4", "2026-11-02");
  assert.equal((await runAlertRound({ store, notify, today: "2026-11-01" })).count, 1, "a new coming cheque is announced");
});
test("alerts off, notifications off, and cleared cheques stay quiet", async () => {
  const { store, add } = await setup();
  const { cheque } = await add("1", "2026-11-01");
  const shown = [];
  const notify = (t, b) => shown.push(b);
  await store.saveAlerts({ ...store.alerts(), notify: false });
  assert.equal((await runAlertRound({ store, notify, today: "2026-11-01" })).count, 1);
  assert.deepEqual(shown, [], "banner and badge only, no Windows notice");
  await store.setStatus(cheque.id, "cleared", { date: "2026-11-01" }, "2026-11-01");
  assert.equal(await runAlertRound({ store, notify, today: "2026-11-02" }), null);
  await store.saveAlerts({ ...store.alerts(), enabled: false });
  await add("2", "2026-11-02");
  assert.equal(await runAlertRound({ store, notify, today: "2026-11-02" }), null);
});
