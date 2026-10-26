// One-time import from the old Cheque Printer register (cheque_writer.db).
// Reads the old file only; nothing in it is changed.
const randomUUID = () => globalThis.crypto.randomUUID();
import { CURRENCIES, validateOptions, validateLayouts } from "../shared/cheque-core.mjs";
import { isIsoDate } from "../shared/cheque-rules.mjs";

const json = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const round3 = (v) => Math.round(v * 1000) / 1000;

function offsetsFor(templates, layoutId, saved) {
  if (!saved || typeof saved !== "object") return {};
  if (saved.offsets && typeof saved.offsets === "object") {
    const out = {};
    for (const [name, delta] of Object.entries(saved.offsets)) {
      if (!delta || typeof delta !== "object") continue;
      const item = {};
      for (const prop of ["left_mm", "top_mm"]) if (Number.isFinite(Number(delta[prop]))) item[prop] = round3(Number(delta[prop]));
      out[name] = { left_mm: item.left_mm ?? 0, top_mm: item.top_mm ?? 0 };
    }
    return out;
  }
  // Early register format: absolute field positions saved per field.
  const base = templates[layoutId]?.fields ?? {};
  const out = {};
  for (const [name, field] of Object.entries(saved)) {
    if (!field || typeof field !== "object" || !base[name]) continue;
    const left = round3(num(field.left_mm, base[name].left_mm) - num(base[name].left_mm, 0));
    const top = round3(num(field.top_mm, base[name].top_mm) - num(base[name].top_mm, 0));
    if (left || top) out[name] = { left_mm: left, top_mm: top };
  }
  return out;
}
function calibrationOf(account, templates, layoutId) {
  const all = json(account.CCAC_FIELD_LAYOUT || "{}", {});
  const saved = all[layoutId] && typeof all[layoutId] === "object" ? all[layoutId] : {};
  let text;
  try {
    text = validateOptions(saved.text_options);
  } catch {
    text = validateOptions(undefined);
  }
  return {
    width: num(account.CCAC_CHEQUE_WIDTH, 0) || 201.8,
    height: num(account.CCAC_CHEQUE_HEIGHT, 0) || 100.9,
    font: num(account.CCAC_FONT_SIZE, 0) || 12.5,
    scale: num(account.CCAC_SCALE_PCT, 0) || 100,
    wrap: Math.trunc(num(account.CCAC_WRAP_CHARS, 0)) || 40,
    x: num(account.CCAC_PRINTER_OFFSET_X, 0),
    y: num(account.CCAC_PRINTER_OFFSET_Y, 0),
    spacing: num(account.CCAC_LINE_SPACING, 0),
    crossingShift: num(account.CCAC_SHIFT_AC_PAYEE, 0),
    printer: account.CCAC_PRINTER_NAME || "",
    tray: account.CCAC_PRINTER_TRAY || "Multi-purpose Tray",
    orientation: account.CCAC_ORIENTATION === "Portrait" ? "Portrait" : "Landscape",
    feed: "cheque_only",
    offsets: offsetsFor(templates, layoutId, saved),
    text,
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function importOldRegister(store, openDb, file) {
  if (!file) throw new Error("Choose the old Cheque Printer file (cheque_writer.db).");
  let old;
  try {
    old = await openDb(file, { readOnly: true });
    const tables = new Set((await old.all("select name from sqlite_master where type='table'", [])).map((r) => r.name));
    if (!tables.has("CS_CW_ACCOUNT") || !tables.has("CS_CW_TRANSACTION")) throw new Error("x");
  } catch {
    await old?.close();
    throw new Error("This is not an old Cheque Printer register (cheque_writer.db).");
  }
  const report = { accounts: 0, accountsReused: 0, cheques: 0, chequesSkipped: 0, ledgerEntries: 0, layouts: 0, payees: 0, warnings: [] };
  try {
    const tables = new Set((await old.all("select name from sqlite_master where type='table'", [])).map((r) => r.name));
    const templates = {};
    if (tables.has("CS_CW_BANK_LAYOUT"))
      for (const r of (await old.all("select id, data from CS_CW_BANK_LAYOUT", []))) templates[r.id] = json(r.data, null);
    // Layouts that differ from (or are missing in) the built-in library.
    const builtIn = (await store.config()).layouts;
    const wanted = {};
    for (const [id, layout] of Object.entries(templates)) if (layout && !same(layout, builtIn[id])) wanted[id] = layout;
    if (Object.keys(wanted).length) {
      for (const [id, layout] of Object.entries(wanted)) {
        try {
          const config = await store.config();
          const names = new Set(Object.entries(config.layouts).filter(([k]) => k !== id).map(([, l]) => (l.display_name || l.id).trim().toLowerCase()));
          const checked = validateLayouts({ [id]: layout })[id];
          if (names.has((checked.display_name || id).trim().toLowerCase())) checked.display_name = `${checked.display_name} (old register)`;
          await store.saveDesign({ kind: "layouts", revision: config.revision, layouts: { [id]: checked }, replace: true });
          report.layouts++;
        } catch (error) {
          report.warnings.push(`Layout ${id} was not imported: ${error instanceof Error ? error.message : "invalid"}`);
        }
      }
    }
    const layouts = (await store.config()).layouts;

    const accountIds = new Map();
    for (const row of (await old.all("select * from CS_CW_ACCOUNT order by CCAC_ID", []))) {
      const name = String(row.CCAC_NAME || "").trim() || `Account ${row.CCAC_NO}`;
      let account = (await store.accounts()).find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (account) report.accountsReused++;
      else {
        account = await store.saveAccount({ name, bankNo: row.CCAC_NO, currency: row.CCAC_CURRENCY || "AED" });
        report.accounts++;
      }
      accountIds.set(row.CCAC_ID, account);
      const saved = json(row.CCAC_FIELD_LAYOUT || "{}", {});
      const layoutIds = [...new Set([...Object.keys(saved).filter((k) => layouts[k]), row.CCAC_BANK_ID].filter((k) => layouts[k]))];
      const own = layouts[row.CCAC_BANK_ID] ? row.CCAC_BANK_ID : layoutIds[0];
      // The account's own layout goes last so it stays selected.
      for (const layoutId of [...layoutIds.filter((k) => k !== own), own].filter(Boolean)) {
        try {
          const config = await store.config();
          await store.saveDesign({ kind: "calibration", revision: config.revision, bankId: account.id, layoutId, calibration: calibrationOf(row, templates, layoutId) });
        } catch (error) {
          report.warnings.push(`Calibration of ${name} / ${layoutId} was not imported: ${error instanceof Error ? error.message : "invalid"}`);
        }
      }
    }

    const cols = new Set((await old.all("pragma table_info(CS_CW_TRANSACTION)", [])).map((c) => c.name));
    const rows = (await old.all("select * from CS_CW_TRANSACTION order by CCT_ID", []));
    await store.tx(async () => {
      for (const t of rows) {
        if (cols.has("CCT_DELETED") && t.CCT_DELETED) continue;
        const account = accountIds.get(t.CCT_ACCOUNT);
        const no = String(t.CCT_CHEQUE_NO ?? "").trim();
        if (!account || !no) continue;
        if (["DEPOSIT", "WITHDRAWAL"].includes(no.toUpperCase())) {
          report.ledgerEntries++;
          continue;
        }
        if (await store.get("select 1 x from cheques where account_id=? and cheque_no=?", account.id, no)) {
          report.chequesSkipped++;
          continue;
        }
        const decimals = CURRENCIES[account.currency]?.decimals ?? 2;
        const voided = t.CCT_VOIDED === "Y";
        const cleared = !voided && isIsoDate(t.CCT_CLEARING_DATE);
        const status = voided ? "cancelled" : cleared ? "cleared" : "pending";
        const id = randomUUID();
        const stamp = new Date().toISOString();
        await store.run(
          "insert into cheques(id,account_id,cheque_no,payee,amount,currency,cheque_date,issued_on,status,status_date,reason,note,layout_id,wording,crossing,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id, account.id, no, String(t.CCT_PAYEE || "").trim() || "(no payee)", Number(t.CCT_AMOUNT || 0).toFixed(decimals), account.currency,
          isIsoDate(t.CCT_DATE) ? t.CCT_DATE : null, isIsoDate(t.CCT_ISSUE_DATE) ? t.CCT_ISSUE_DATE : String(stamp).slice(0, 10),
          status, cleared ? t.CCT_CLEARING_DATE : null, "", String(t.CCT_REMARK || "").slice(0, 300), "", String(t.CCT_WORDING || "").slice(0, 2000),
          t.CCT_AC_PAYEE_ONLY === "N" ? 0 : Number(t.CCT_CROSSING_OPTION) || 1, stamp, stamp,
        );
        await store.log(id, "imported", null, status, "from the old Cheque Printer register");
        report.cheques++;
      }
    });
    if (tables.has("CS_CW_PAYEE")) {
      const names = (await old.all("select CCP_NAME from CS_CW_PAYEE", [])).map((r) => r.CCP_NAME);
      const before = (await store.payees()).length;
      try {
        await store.importPayees(names);
      } catch (error) {
        report.warnings.push(`Some payees were not imported: ${error instanceof Error ? error.message : "invalid"}`);
      }
      report.payees = (await store.payees()).length - before;
    }
  } finally {
    await old.close();
  }
  return report;
}
