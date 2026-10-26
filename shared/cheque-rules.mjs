// Cheque list rules: statuses, due dates and alerts. Pure functions, shared by the window and the app core.

export const STATUSES = ["pending", "cleared", "returned", "cancelled"];
export const STATUS_LABEL = { pending: "Pending", cleared: "Cleared", returned: "Returned", cancelled: "Cancelled" };

export const DEFAULT_ALERTS = {
  enabled: true,
  /** Cheques dated within this many days (and today) are "coming". */
  daysAhead: 3,
  /** A pending cheque this many days past its date is flagged as not cleared yet. */
  overdueAfterDays: 5,
  /** Windows notification as well as the banner and the badge. */
  notify: true,
  startWithWindows: false,
  keepInTray: true,
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(text) {
  const m = ISO.exec(String(text ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** Whole days from a to b (b - a), both ISO dates. */
export function daysBetween(a, b) {
  const x = ISO.exec(a),
    y = ISO.exec(b);
  if (!x || !y) return NaN;
  return Math.round((Date.UTC(+y[1], +y[2] - 1, +y[3]) - Date.UTC(+x[1], +x[2] - 1, +x[3])) / 86400000);
}

/** How a pending cheque stands against its cheque date. Other statuses are never due. */
export function dueInfo(cheque, today, alerts = DEFAULT_ALERTS) {
  if (cheque.status !== "pending" || !cheque.chequeDate) return { kind: "none", days: null };
  const days = daysBetween(today, cheque.chequeDate);
  if (days === 0) return { kind: "today", days };
  if (days > 0) return { kind: days <= alerts.daysAhead ? "soon" : "later", days };
  return { kind: -days >= alerts.overdueAfterDays ? "overdue" : "recent", days };
}

export function alertSummary(cheques, today, alerts = DEFAULT_ALERTS) {
  const out = { overdue: [], today: [], soon: [] };
  if (!alerts.enabled) return { ...out, count: 0 };
  for (const cheque of cheques) {
    const { kind } = dueInfo(cheque, today, alerts);
    if (kind === "overdue") out.overdue.push(cheque);
    else if (kind === "today") out.today.push(cheque);
    else if (kind === "soon") out.soon.push(cheque);
  }
  const byDate = (a, b) => String(a.chequeDate).localeCompare(String(b.chequeDate));
  for (const list of Object.values(out)) list.sort(byDate);
  return { ...out, count: out.overdue.length + out.today.length + out.soon.length };
}
export function alertText(summary) {
  const parts = [];
  if (summary.today.length) parts.push(`${summary.today.length} due today`);
  if (summary.soon.length) parts.push(`${summary.soon.length} coming soon`);
  if (summary.overdue.length) parts.push(`${summary.overdue.length} not cleared after the cheque date`);
  return parts.join(", ");
}

/** Checks a status change and returns the values to store. */
export function checkStatusChange(cheque, to, input = {}, today = todayISO()) {
  if (!STATUSES.includes(to)) throw new Error("Choose a valid status.");
  const reason = String(input.reason ?? "").trim();
  if (reason.length > 300) throw new Error("The note can have at most 300 characters.");
  const date = input.date ? String(input.date) : today;
  if (to === "pending") return { status: "pending", statusDate: null, reason: "" };
  if (!isIsoDate(date)) throw new Error("Enter the date as YYYY-MM-DD.");
  if (to === "returned" && reason.length < 3) throw new Error("Enter the reason the cheque was returned.");
  if (cheque.status === to && (cheque.statusDate || null) === date && (cheque.reason || "") === reason)
    throw new Error(`This cheque is already ${STATUS_LABEL[to].toLowerCase()}.`);
  return { status: to, statusDate: date, reason };
}

export function filterCheques(rows, filter = {}, today = todayISO(), alerts = DEFAULT_ALERTS) {
  const q = String(filter.q ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status === "coming") {
      if (row.status !== "pending" || !row.chequeDate || row.chequeDate < today) return false;
    } else if (filter.status === "attention") {
      if (!["today", "soon", "overdue"].includes(dueInfo(row, today, alerts).kind)) return false;
    } else if (filter.status && filter.status !== "all" && row.status !== filter.status) return false;
    if (filter.accountId && row.accountId !== filter.accountId) return false;
    if (filter.from && (!row.chequeDate || row.chequeDate < filter.from)) return false;
    if (filter.to && (!row.chequeDate || row.chequeDate > filter.to)) return false;
    if (q) {
      const hay = `${row.chequeNo} ${row.payee} ${row.amount} ${row.note ?? ""} ${row.reason ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function checkAlertSettings(input) {
  const value = { ...DEFAULT_ALERTS, ...(input && typeof input === "object" ? input : {}) };
  for (const key of ["enabled", "notify", "startWithWindows", "keepInTray"])
    if (typeof value[key] !== "boolean") throw new Error("Check the alert settings.");
  for (const [key, max] of [["daysAhead", 60], ["overdueAfterDays", 90]])
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > max)
      throw new Error(`Use a whole number from 0 to ${max} for the alert days.`);
  return {
    enabled: value.enabled,
    daysAhead: value.daysAhead,
    overdueAfterDays: value.overdueAfterDays,
    notify: value.notify,
    startWithWindows: value.startWithWindows,
    keepInTray: value.keepInTray,
  };
}

/** Cheque record from a printed cheque: what the list keeps. */
export function chequeFromPrint({ accountId, values, currency, layoutId, wording, today = todayISO() }) {
  const number = String(values.number ?? "").trim();
  const payee = String(values.payee ?? "").trim();
  const amount = String(values.amount ?? "").replaceAll(",", "").trim();
  if (!number) throw new Error("Enter the cheque number.");
  if (!payee) throw new Error("Enter the payee.");
  if (!/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0)) throw new Error("Enter a positive amount.");
  const date = values.blankDate ? null : String(values.date ?? "");
  if (date !== null && !isIsoDate(date)) throw new Error("Enter the cheque date as YYYY-MM-DD, or tick Blank date.");
  return {
    accountId,
    chequeNo: number,
    payee: values.payeeCaps ? payee.toUpperCase() : payee,
    amount,
    currency: currency || "AED",
    chequeDate: date,
    issuedOn: today,
    layoutId: layoutId || "",
    wording: wording || "",
    crossing: values.crossed ? Number(values.crossing) || 1 : 0,
  };
}

/** Cheque record from the normalized engine data (what was really printed). */
export function chequeFromData({ accountId, data, layoutId, today = todayISO() }) {
  const number = String(data.CCT_CHEQUE_NO ?? "").trim();
  const payee = String(data.CCT_PAYEE ?? "").trim();
  const amount = String(data.CCT_AMOUNT ?? "").trim();
  if (!number) throw new Error("Enter the cheque number.");
  if (!payee) throw new Error("Enter the payee.");
  if (!/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0)) throw new Error("Enter a positive amount.");
  return {
    accountId,
    chequeNo: number,
    payee,
    amount,
    currency: data.CCT_CURRENCY || "AED",
    chequeDate: data.CCT_DATE ? String(data.CCT_DATE) : null,
    issuedOn: today,
    layoutId: layoutId || "",
    wording: String(data.CCT_WORDING ?? ""),
    crossing: data.CCT_AC_PAYEE_ONLY === "Y" ? Number(data.CCT_CROSSING_OPTION) || 1 : 0,
  };
}
