import { alertText } from "../shared/cheque-rules.mjs";

/**
 * One alert round: tells the person about cheques that are due, once per cheque per day.
 * `notify(title, body)` shows the Windows notification. Returns what was announced, or null.
 */
export async function runAlertRound({ store, notify, today }) {
  const settings = await store.alerts();
  if (!settings.enabled) return null;
  const unseen = await store.unseenAlerts(today);
  if (!unseen.count) return null;
  if (settings.notify) await notify("SJMR Cheque Writer", alertText(unseen));
  await store.markSeen(unseen, today);
  return unseen;
}
