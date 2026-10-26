// Everything the window can ask the app to do. The same functions serve the real window
// (through the app core) and the tests.
import { prepare } from "../shared/cheque-core.mjs";
import { chequeFromData, todayISO } from "../shared/cheque-rules.mjs";
import { importOldRegister } from "./importer.mjs";
import { checkTemplateSettings } from "./template-settings.mjs";

export function createApi({ store, engine, templatePrinter, savePdf, chooseFile, openDb, hooks = {}, now = () => new Date() }) {
  // One store call at a time: a transaction on the shared connection never meets another call.
  let chain = Promise.resolve();
  const locked = (work) => {
    const next = chain.then(work);
    chain = next.catch(() => {});
    return next;
  };
  const today = () => todayISO(now());
  const state = async () => ({
    config: await store.config(),
    accounts: await store.accounts(),
    payees: await store.payees(),
    payeeAr: await store.payeeArabic(),
    lastBackup: await store.setting("last_backup", null),
    alerts: await store.alerts(),
    summary: await store.summary(),
    today: today(),
  });
  return {
    /** The one-at-a-time door, for the few callers outside this file (the data copy). */
    locked,
    state: () => locked(state),

    // ---- cheque writing --------------------------------------------------------------------------
    preview: (request) => engine.execute("preview", request),
    printers: () => engine.execute("printers"),
    image: (data) => engine.execute("image", { data }),
    validateLayouts: (layouts) => engine.execute("validate-layouts", { layouts }),
    nextChequeNo: (accountId) => locked(() => store.nextChequeNo(accountId)),

    /** Print or save a PDF; add the cheque to the list only when asked and only after it really went out. */
    async output({ action, request, list }) {
      if (!["direct", "dialog", "pdf"].includes(action)) throw new Error("Choose a cheque output action.");
      const prepared = prepare({ ...request, action: action === "pdf" ? "pdf" : action });
      if (list?.accountId) await locked(() => store.checkAddable(list.accountId, prepared.data.CCT_CHEQUE_NO));
      const result = await engine.execute(action, request, { mainWindow: true });
      let message;
      if (action === "pdf") {
        const file = await savePdf(result.pdf, `Cheque-${String(prepared.data.CCT_CHEQUE_NO).replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
        if (!file) return { ok: true, cancelled: true, message: "PDF not saved.", saved: null };
        message = `Cheque PDF saved: ${file}`;
      } else if (result.cancelled) return { ok: true, cancelled: true, message: "Print cancelled.", saved: null };
      else if (!result.ok) throw new Error(result.message || "The printer did not accept this cheque.");
      else message = "Cheque sent to the printer.";
      if (!list?.accountId) return { ok: true, cancelled: false, message, saved: null };
      try {
        const saved = await locked(async () => {
          const added = await store.addCheque(chequeFromData({ accountId: list.accountId, data: prepared.data, layoutId: list.layoutId, today: today() }));
          try {
            // An Arabic cheque keeps its English name in the payee list, with the Arabic spelling beside it.
            const key = String(list.payee ?? "").trim();
            if (key && String(list.arabic ?? "").trim()) await store.setPayeeArabic(key, list.arabic);
            else await store.addPayee(key || added.cheque.payee);
          } catch {
            // The payee list is a convenience; the cheque is already listed.
          }
          return added;
        });
        return { ok: true, cancelled: false, message: `${message} ${saved.updated ? "The cheque in the list was updated." : "Added to the cheque list."}`, saved };
      } catch (error) {
        return { ok: true, cancelled: false, message, saved: null, listError: error instanceof Error ? error.message : "Could not add the cheque to the list." };
      }
    },

    // ---- template printer (the picture, layout and PDF are made in the window) ------------------------
    templatePrinters: () => templatePrinter.printers(),
    templatePrint: (job) => templatePrinter.print(job),
    async templateSavePdf({ base64, name }) {
      const file = await savePdf(base64, String(name || "Precision_Print.pdf").replace(/[^a-zA-Z0-9._ -]/g, "_"));
      return file ? { ok: true, cancelled: false, message: `PDF saved: ${file}`, file } : { ok: true, cancelled: true, message: "PDF not saved.", file: null };
    },
    templateSettings: () => locked(async () => checkTemplateSettings(await store.setting("templatePrinter", {}))),
    saveTemplateSettings: (input) =>
      locked(async () => {
        const value = checkTemplateSettings(input);
        await store.putSetting("templatePrinter", value);
        return value;
      }),

    // ---- design and accounts ---------------------------------------------------------------------
    saveDesign: (data) => locked(() => store.saveDesign(data)),
    saveAccount: (input) => locked(() => store.saveAccount(input)),
    deleteAccount: (id) => locked(async () => (await store.deleteAccount(id), null)),

    // ---- payees ----------------------------------------------------------------------------------
    setPayeeArabic: ({ name, arabic }) => locked(() => store.setPayeeArabic(name, arabic)),
    restoreCheque: (cheque) => locked(() => store.restoreCheque(cheque)),
    markBackup: (when) => locked(() => store.putSetting("last_backup", when)),
    addPayee: (name) => locked(async () => (await store.addPayee(name), store.payees())),
    removePayee: (name) => locked(async () => (await store.removePayee(name), store.payees())),
    importPayees: (list) => locked(async () => ({ added: await store.importPayees(list), payees: await store.payees() })),
    replacePayees: (list) => locked(() => store.replacePayees(list)),

    // ---- cheque list -----------------------------------------------------------------------------
    cheques: (filter) => locked(() => store.cheques(filter, today())),
    chequeHistory: (id) => locked(() => store.history(id)),
    setStatus: ({ id, to, date, reason }) => locked(() => store.setStatus(id, to, { date, reason }, today())),
    setStatusMany: ({ ids, to, date, reason }) => locked(() => store.setStatusMany(ids, to, { date, reason }, today())),
    setNote: ({ id, note }) => locked(() => store.setNote(id, note)),
    setChequeDate: ({ id, date }) => locked(() => store.setChequeDate(id, date)),
    deleteCheque: (id) => locked(async () => (await store.deleteCheque(id), null)),

    // ---- alerts and settings ---------------------------------------------------------------------
    alerts: () => locked(async () => ({ summary: await store.alertSummary(today()), settings: await store.alerts(), today: today() })),
    saveAlerts: async (input) => {
      const value = await locked(() => store.saveAlerts(input));
      await hooks.onAlertSettings?.(value);
      return value;
    },

    // ---- data file -------------------------------------------------------------------------------
    importOld: async (file) => {
      const path = file || (await chooseFile?.("Choose the old Cheque Printer file (cheque_writer.db)", [{ name: "Cheque Printer register", extensions: ["db"] }]));
      if (!path) return null;
      return locked(() => importOldRegister(store, openDb, path));
    },
  };
}
