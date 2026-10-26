// Local data file (SQLite): bank accounts, the layout library, payees and the cheque list.
// Runs in the window; `db` is the host's database handle: { exec(sql, params) -> {changes}, all(sql, params) -> rows, close() }.
// The api layer runs one store call at a time, so one open transaction never meets another call.
import BUILT_IN from "../shared/bank-layouts.json" with { type: "json" };
import { validateLayouts } from "../shared/cheque-core.mjs";
import {
  DEFAULT_ALERTS,
  STATUS_LABEL,
  alertSummary,
  checkAlertSettings,
  checkStatusChange,
  filterCheques,
  isIsoDate,
  todayISO,
} from "../shared/cheque-rules.mjs";

const randomUUID = () => globalThis.crypto.randomUUID();
const RESERVED = ["__proto__", "constructor", "prototype"];
const MAX_CONFIG = 20 * 1024 * 1024;

const SCHEMA = `
create table if not exists settings(key text primary key, value text not null);
create table if not exists accounts(
  id text primary key, name text not null, bank_no text not null default '', currency text not null default 'AED',
  active integer not null default 1, created_at text not null);
create table if not exists cheques(
  id text primary key,
  account_id text not null references accounts(id),
  cheque_no text not null, payee text not null, amount text not null, currency text not null default 'AED',
  cheque_date text, issued_on text not null,
  status text not null default 'pending' check (status in ('pending','cleared','returned','cancelled')),
  status_date text, reason text not null default '', note text not null default '',
  layout_id text not null default '', wording text not null default '', crossing integer not null default 1,
  created_at text not null, updated_at text not null,
  unique(account_id, cheque_no));
create index if not exists cheques_date on cheques(cheque_date);
create index if not exists cheques_status on cheques(status);
create table if not exists cheque_log(
  id integer primary key autoincrement, cheque_id text not null, at text not null,
  action text not null, from_status text, to_status text, detail text not null default '');
create index if not exists cheque_log_cheque on cheque_log(cheque_id);
create table if not exists payees(name text primary key collate nocase);
create table if not exists alerts_seen(cheque_id text not null, day text not null, kind text not null, primary key(cheque_id, day, kind));
`;

const now = () => new Date().toISOString();
const rowCheque = (r) =>
  r && {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name ?? "",
    chequeNo: r.cheque_no,
    payee: r.payee,
    amount: r.amount,
    currency: r.currency,
    chequeDate: r.cheque_date,
    issuedOn: r.issued_on,
    status: r.status,
    statusDate: r.status_date,
    reason: r.reason,
    note: r.note,
    layoutId: r.layout_id,
    wording: r.wording,
    crossing: r.crossing,
    createdAt: r.created_at,
  };
const rowAccount = (r) => ({ id: r.id, name: r.name, bankNo: r.bank_no, currency: r.currency, active: !!r.active, createdAt: r.created_at });

export class ChequeStore {
  constructor(db, file = "") {
    this.db = db;
    this.file = file;
    this.depth = 0;
  }
  static async open(db, file = "") {
    const store = new ChequeStore(db, file);
    await db.exec("pragma foreign_keys = on");
    if (file && file !== ":memory:") await db.exec("pragma journal_mode = wal");
    for (const statement of SCHEMA.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await db.exec(statement);
    return store;
  }
  async close() {
    await this.db.close();
  }
  async tx(work) {
    if (this.depth) return work();
    await this.db.exec("begin immediate");
    this.depth = 1;
    try {
      const result = await work();
      await this.db.exec("commit");
      return result;
    } catch (error) {
      await this.db.exec("rollback");
      throw error;
    } finally {
      this.depth = 0;
    }
  }
  async get(sql, ...p) {
    return (await this.db.all(sql, p))[0];
  }
  async all(sql, ...p) {
    return this.db.all(sql, p);
  }
  async run(sql, ...p) {
    return this.db.exec(sql, p);
  }

  // ---- settings ---------------------------------------------------------------------------------
  async setting(key, fallback) {
    const row = await this.get("select value from settings where key=?", key);
    return row ? JSON.parse(row.value) : fallback;
  }
  async putSetting(key, value) {
    await this.run("insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value", key, JSON.stringify(value));
  }
  async alerts() {
    return { ...DEFAULT_ALERTS, ...await this.setting("alerts", {}) };
  }
  async saveAlerts(input) {
    const value = checkAlertSettings(input);
    await this.putSetting("alerts", value);
    return value;
  }

  // ---- layout library and calibration (same shape and rules as SJMR Accounting) -----------------
  async config() {
    const saved = await this.setting("designs", null);
    if (saved) {
      if (saved.version !== 1) throw new Error("Unsupported cheque design settings. Update the program.");
      return saved;
    }
    return { version: 1, revision: 0, layouts: structuredClone(BUILT_IN), banks: {} };
  }
  async saveDesign(data) {
    if (!data || typeof data !== "object" || JSON.stringify(data).length > MAX_CONFIG)
      throw new Error("Choose a cheque design under 20 MB.");
    return await this.tx(async () => {
      const config = await this.config();
      if (config.revision !== data.revision) throw new Error("Cheque settings changed. Reload before saving.");
      if (data.kind === "calibration") {
        const account = await this.get("select id from accounts where id=?", data.bankId);
        if (!account || !Object.hasOwn(config.layouts, data.layoutId))
          throw new Error("Select a bank account and a saved layout.");
        const old = config.banks[data.bankId];
        config.banks[data.bankId] = { layoutId: data.layoutId, calibration: { ...old?.calibration, [data.layoutId]: data.calibration } };
      } else if (data.kind === "layouts") {
        const checked = validateLayouts(data.layouts);
        for (const [id, layout] of Object.entries(checked)) {
          if (RESERVED.includes(id)) throw new Error("Choose a different bank layout ID; this name is reserved.");
          if (!Object.hasOwn(config.layouts, id) || data.replace === true) config.layouts[id] = layout;
        }
      } else if (data.kind === "delete") {
        if (!Object.hasOwn(config.layouts, data.id)) throw new Error("Bank layout no longer exists.");
        if (Object.values(config.banks).some((bank) => bank.layoutId === data.id))
          throw new Error("This layout is assigned to a bank account. Assign another layout before deleting it.");
        if (Object.keys(config.layouts).length <= 1) throw new Error("Keep at least one bank layout.");
        delete config.layouts[data.id];
      } else throw new Error("Choose a valid design action.");
      const names = Object.values(config.layouts).map((l) => (l.display_name || l.id).trim().toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Bank layout names must be unique.");
      config.revision += 1;
      const json = JSON.stringify(config);
      if (json.length > MAX_CONFIG) throw new Error("The layout library is too large. Use smaller photos.");
      await this.putSetting("designs", config);
      return config;
    });
  }

  // ---- bank accounts ----------------------------------------------------------------------------
  async accounts() {
    return (await this.all("select * from accounts order by lower(name)")).map(rowAccount);
  }
  async saveAccount(input) {
    const name = String(input?.name ?? "").trim();
    const bankNo = String(input?.bankNo ?? "").trim();
    const currency = String(input?.currency ?? "AED").trim().toUpperCase();
    if (!name || name.length > 120) throw new Error("Enter the account name (up to 120 characters).");
    if (bankNo.length > 60) throw new Error("The account number can have at most 60 characters.");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter the currency as a 3-letter code, for example AED.");
    const duplicate = await this.get("select id from accounts where lower(name)=lower(?) and id<>?", name, input?.id ?? "");
    if (duplicate) throw new Error("A bank account with this name already exists.");
    if (input?.id) {
      const old = await this.get("select * from accounts where id=?", input.id);
      if (!old) throw new Error("This bank account no longer exists.");
      if (old.currency !== currency && await this.get("select 1 x from cheques where account_id=? limit 1", input.id))
        throw new Error("The currency cannot change after cheques were listed for this account.");
      await this.run("update accounts set name=?, bank_no=?, currency=?, active=? where id=?", name, bankNo, currency, input.active === false ? 0 : 1, input.id);
      return rowAccount(await this.get("select * from accounts where id=?", input.id));
    }
    const id = randomUUID();
    await this.run("insert into accounts(id,name,bank_no,currency,active,created_at) values(?,?,?,?,1,?)", id, name, bankNo, currency, now());
    return rowAccount(await this.get("select * from accounts where id=?", id));
  }
  async deleteAccount(id) {
    if (await this.get("select 1 x from cheques where account_id=? limit 1", id))
      throw new Error("This account has cheques in the list. Mark it inactive instead of deleting it.");
    await this.tx(async () => {
      await this.run("delete from accounts where id=?", id);
      const config = await this.config();
      if (config.banks[id]) {
        delete config.banks[id];
        config.revision += 1;
        await this.putSetting("designs", config);
      }
    });
  }

  // ---- payees (the Custom List) -----------------------------------------------------------------
  async payees() {
    return (await this.all("select name from payees order by name")).map((r) => r.name);
  }
  async addPayee(name) {
    const text = String(name ?? "").trim();
    if (!text) throw new Error("Enter a payee name.");
    if (text.length > 500 || [...text].some((c) => c.charCodeAt(0) < 32)) throw new Error("Payee names have at most 500 characters and no control characters.");
    await this.run("insert or ignore into payees(name) values(?)", text);
  }
  async removePayee(name) {
    await this.run("delete from payees where name=?", String(name));
  }
  async replacePayees(list) {
    if (!Array.isArray(list) || list.length > 50000) throw new Error("Choose a list of up to 50,000 payee names.");
    await this.tx(async () => {
      await this.run("delete from payees");
      for (const name of list) await this.addPayee(name);
    });
    return await this.payees();
  }
  async importPayees(list) {
    if (!Array.isArray(list)) throw new Error("Choose a list of payee names.");
    let added = 0;
    await this.tx(async () => {
      for (const name of list) {
        const before = await this.get("select 1 x from payees where name=?", String(name).trim());
        await this.addPayee(name);
        if (!before) added++;
      }
    });
    return added;
  }

  // ---- cheque list ------------------------------------------------------------------------------
  async log(id, action, from, to, detail = "") {
    await this.run("insert into cheque_log(cheque_id,at,action,from_status,to_status,detail) values(?,?,?,?,?,?)", id, now(), action, from ?? null, to ?? null, detail);
  }
  async cheque(id) {
    return rowCheque(
      await this.get("select c.*, a.name account_name from cheques c join accounts a on a.id=c.account_id where c.id=?", id),
    );
  }
  async cheques(filter = {}, today = todayISO()) {
    const rows = (
      await this.all(
        "select c.*, a.name account_name from cheques c join accounts a on a.id=c.account_id order by coalesce(c.cheque_date,'9999-12-31'), c.cheque_no",
      )
    ).map(rowCheque);
    return filterCheques(rows, filter, today, await this.alerts());
  }
  /** Called before printing, so a refused number never wastes a cheque leaf. */
  async checkAddable(accountId, chequeNo) {
    const old = await this.get("select status from cheques where account_id=? and cheque_no=?", accountId, String(chequeNo).trim());
    if (old && old.status !== "pending")
      throw new Error(
        `Cheque ${String(chequeNo).trim()} is already ${STATUS_LABEL[old.status].toLowerCase()} in the list. Choose another cheque number, or untick "Add cheque to list".`,
      );
    return { exists: !!old };
  }
  async addCheque(rec) {
    if (!await this.get("select 1 x from accounts where id=?", rec.accountId)) throw new Error("Select a bank account.");
    return await this.tx(async () => {
      const { exists } = await this.checkAddable(rec.accountId, rec.chequeNo);
      if (exists) {
        const old = await this.get("select id from cheques where account_id=? and cheque_no=?", rec.accountId, rec.chequeNo);
        await this.run(
          "update cheques set payee=?, amount=?, currency=?, cheque_date=?, issued_on=?, layout_id=?, wording=?, crossing=?, updated_at=? where id=?",
          rec.payee, rec.amount, rec.currency, rec.chequeDate, rec.issuedOn, rec.layoutId, rec.wording, rec.crossing, now(), old.id,
        );
        await this.log(old.id, "printed again", "pending", "pending", `${rec.payee} ${rec.amount}`);
        return { cheque: await this.cheque(old.id), updated: true };
      }
      const id = randomUUID();
      await this.run(
        "insert into cheques(id,account_id,cheque_no,payee,amount,currency,cheque_date,issued_on,status,layout_id,wording,crossing,created_at,updated_at) values(?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)",
        id, rec.accountId, rec.chequeNo, rec.payee, rec.amount, rec.currency, rec.chequeDate, rec.issuedOn, rec.layoutId, rec.wording, rec.crossing, now(), now(),
      );
      await this.log(id, "added", null, "pending", `${rec.payee} ${rec.amount}`);
      return { cheque: await this.cheque(id), updated: false };
    });
  }
  async setStatus(id, to, input = {}, today = todayISO()) {
    return await this.tx(async () => {
      const old = await this.cheque(id);
      if (!old) throw new Error("This cheque is no longer in the list.");
      const next = checkStatusChange(old, to, input, today);
      await this.run("update cheques set status=?, status_date=?, reason=?, updated_at=? where id=?", next.status, next.statusDate, next.reason, now(), id);
      await this.log(id, `marked ${to}`, old.status, to, [next.statusDate, next.reason].filter(Boolean).join(" · "));
      return await this.cheque(id);
    });
  }
  async setStatusMany(ids, to, input = {}, today = todayISO()) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error("Select between 1 and 500 cheques.");
    return this.tx(async () => {
      const out = [];
      for (const id of ids) out.push(await this.setStatus(id, to, input, today));
      return out;
    });
  }
  async setNote(id, note) {
    const text = String(note ?? "").trim();
    if (text.length > 300) throw new Error("The note can have at most 300 characters.");
    if (!await this.cheque(id)) throw new Error("This cheque is no longer in the list.");
    await this.run("update cheques set note=?, updated_at=? where id=?", text, now(), id);
    await this.log(id, "note changed", null, null, text);
    return await this.cheque(id);
  }
  async setChequeDate(id, date) {
    const old = await this.cheque(id);
    if (!old) throw new Error("This cheque is no longer in the list.");
    if (date !== null && !isIsoDate(date)) throw new Error("Enter the date as YYYY-MM-DD.");
    await this.run("update cheques set cheque_date=?, updated_at=? where id=?", date, now(), id);
    await this.log(id, "date changed", null, null, `${old.chequeDate ?? "blank"} → ${date ?? "blank"}`);
    return await this.cheque(id);
  }
  async deleteCheque(id) {
    await this.tx(async () => {
      await this.run("delete from cheque_log where cheque_id=?", id);
      await this.run("delete from alerts_seen where cheque_id=?", id);
      await this.run("delete from cheques where id=?", id);
    });
  }
  async history(id) {
    return await this.all("select at, action, from_status, to_status, detail from cheque_log where cheque_id=? order by id", id);
  }
  /** Next cheque number for an account: the highest numeric number in the list, plus one (same width). */
  async nextChequeNo(accountId) {
    const rows = await this.all("select cheque_no from cheques where account_id=?", accountId);
    let best = null;
    for (const { cheque_no: n } of rows) if (/^\d{1,30}$/.test(n) && (best === null || BigInt(n) > BigInt(best))) best = n;
    return best === null ? null : (BigInt(best) + 1n).toString().padStart(best.length, "0");
  }

  // ---- alerts -----------------------------------------------------------------------------------
  async alertSummary(today = todayISO()) {
    return alertSummary(await this.cheques({}, today), today, await this.alerts());
  }
  /** Cheques to announce by Windows notification today: each is announced once per day. */
  async unseenAlerts(today = todayISO()) {
    const summary = await this.alertSummary(today);
    const out = { overdue: [], today: [], soon: [], count: 0 };
    for (const kind of ["overdue", "today", "soon"])
      for (const cheque of summary[kind])
        if (!await this.get("select 1 x from alerts_seen where cheque_id=? and day=? and kind=?", cheque.id, today, kind)) out[kind].push(cheque);
    out.count = out.overdue.length + out.today.length + out.soon.length;
    return out;
  }
  async markSeen(summary, today = todayISO()) {
    await this.tx(async () => {
      for (const kind of ["overdue", "today", "soon"])
        for (const c of summary[kind]) await this.run("insert or ignore into alerts_seen(cheque_id,day,kind) values(?,?,?)", c.id, today, kind);
      await this.run("delete from alerts_seen where day < date(?, '-30 day')", today);
    });
  }

  // ---- file copy --------------------------------------------------------------------------------
  /** The host removes an existing target first (VACUUM INTO refuses to overwrite). */
  async backupTo(target) {
    if (!target || target === this.file) throw new Error("Choose another file for the copy.");
    await this.db.exec("vacuum into ?", [String(target)]);
  }
  async summary() {
    return {
      accounts: (await this.get("select count(*) n from accounts")).n,
      cheques: (await this.get("select count(*) n from cheques")).n,
      payees: (await this.get("select count(*) n from payees")).n,
    };
  }
}

/** Opens a file only to see whether it is one of ours (used before a restore). */
export async function checkDataFile(openDb, file) {
  const refuse = () => new Error("This is not a SJMR Cheque Writer data file.");
  let db;
  try {
    db = await openDb(file, { readOnly: true });
    const names = new Set((await db.all("select name from sqlite_master where type='table'", [])).map((r) => r.name));
    for (const need of ["accounts", "cheques", "cheque_log", "settings", "payees"]) if (!names.has(need)) throw refuse();
  } catch {
    throw refuse();
  } finally {
    await db?.close();
  }
}
