// The cheque writer as one object: `createCore(host)` opens the data file through the host, builds
// the store, engine and API, and returns `invoke(name, ...args)`, the single door the screens use.
// Two hosts exist: the Windows shell (Tauri, see src/lib/host-tauri.ts) and the test host.
//
// host = {
//   platform: "win32" | "other",
//   dataFile: string,                       // the main data file
//   openDb(path, { readOnly }) -> db,       // db = { exec(sql, params) -> { changes }, all(sql, params) -> rows, close() }
//   runHelper({ args, job, visible, timeoutMs }) -> { code, out, err },
//   savePdf(base64, name) -> path | null,
//   pickOpen(title, filters) -> path | null,
//   pickSave(title, name, filters) -> path | null,
//   confirm(message, detail) -> boolean,
//   removeFile(path), openFolder(), about() -> { version, dataFolder, portable, developer },
//   replaceDataFile(source),                // closes the open file, keeps a safety copy, swaps, restarts
//   notify(title, body), applyAlertSettings(settings, tip), setTip(text), onNavigate(callback) -> stop,
//   loadFont?() -> Uint8Array          the Arabic font file (needed to draw Arabic in the PDF)
//   now?() -> Date,
// }
import { alertText, todayISO } from "../shared/cheque-rules.mjs";
import { createApi } from "./api.mjs";
import { runAlertRound } from "./alerts.mjs";
import { createChequeEngine } from "./engine.mjs";
import { createTemplatePrinter } from "./template.mjs";
import { ChequeStore, checkDataFile } from "./store.mjs";

export async function createCore(host) {
  const now = () => (host.now ? host.now() : new Date());
  const db = await host.openDb(host.dataFile, { readOnly: false });
  const store = await ChequeStore.open(db, host.dataFile);
  const engine = createChequeEngine({ runHelper: host.runHelper, platform: host.platform, loadFont: host.loadFont });
  const templatePrinter = createTemplatePrinter({ runHelper: host.runHelper, platform: host.platform });
  const tip = async () => {
    const summary = await store.alertSummary(todayISO(now()));
    const text = alertText(summary);
    return text ? `SJMR Cheque Writer — ${text}` : "SJMR Cheque Writer";
  };
  const applySettings = async (settings) => {
    await host.applyAlertSettings?.(settings, await tip());
  };
  const api = createApi({
    store,
    engine,
    templatePrinter,
    openDb: host.openDb,
    hooks: { onAlertSettings: applySettings },
    savePdf: (base64, name) => host.savePdf(base64, name),
    chooseFile: (title, filters) => host.pickOpen(title, filters),
    now,
  });
  const refreshTip = async () => host.setTip?.(await tip());

  const extra = {
    async dataBackup() {
      const stamp = todayISO(now());
      const file = await host.pickSave("Save a copy of the data", `SJMR-Cheque-Writer-Data-${stamp}.db`, [{ name: "Data copy", extensions: ["db"] }]);
      if (!file) return null;
      await api.locked(async () => {
        await host.removeFile(file);
        await store.backupTo(file);
        await store.putSetting("last_backup", stamp);
      });
      return file;
    },
    async dataRestore() {
      const file = await host.pickOpen("Choose a data copy to restore", [{ name: "Data copy", extensions: ["db"] }]);
      if (!file) return null;
      await checkDataFile(host.openDb, file);
      const sure = await host.confirm("Replace all current data with this copy?", "The current data is kept as a safety copy beside it. The program restarts.");
      if (!sure) return null;
      await host.replaceDataFile(file);
      return file;
    },
    openDataFolder: async () => (await host.openFolder(), (await host.about()).dataFolder),
    about: async () => host.about(),
  };
  // A copy of the data is kept beside the data file once a day, one file for each weekday (so the last
  // seven days stay and nothing needs to be deleted), and the date of the last copy is remembered.
  async function autoBackup() {
    try {
      const day = todayISO(now());
      if ((await store.setting("last_auto_backup", "")) === day) return;
      const slash = Math.max(host.dataFile.lastIndexOf("/"), host.dataFile.lastIndexOf("\\"));
      if (slash < 0 || host.dataFile === ":memory:") return;
      const dir = host.dataFile.slice(0, slash);
      const file = `${dir}/auto-backup-${["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now().getDay()]}.db`;
      await api.locked(async () => {
        await host.removeFile(file);
        await store.backupTo(file);
        await store.putSetting("last_auto_backup", day);
        await store.putSetting("last_backup", day);
      });
    } catch (error) {
      console.error("automatic copy failed:", error);
    }
  }
  const changesTray = new Set(["setStatus", "setStatusMany", "output", "deleteCheque", "importOld"]);
  async function invoke(name, ...args) {
    if (Object.hasOwn(extra, name)) return extra[name](...args);
    if (!Object.hasOwn(api, name) || name === "locked") throw new Error("Unknown action.");
    const value = await api[name](...args);
    if (changesTray.has(name)) void refreshTip().catch(() => {});
    return value === undefined ? null : value;
  }

  async function alertRound() {
    try {
      await runAlertRound({ store, today: todayISO(now()), notify: (title, body) => host.notify?.(title, body) });
      await refreshTip();
    } catch (error) {
      console.error("alert round failed:", error);
    }
  }
  const timers = [];
  function startAlerts() {
    timers.push(setTimeout(alertRound, 4000), setInterval(alertRound, 30 * 60 * 1000));
    timers.push(setTimeout(autoBackup, 20000), setInterval(autoBackup, 6 * 60 * 60 * 1000));
  }
  await applySettings(await store.alerts());
  return {
    invoke,
    store,
    api,
    alertRound,
    autoBackup,
    startAlerts,
    stop() {
      for (const t of timers) clearTimeout(t), clearInterval(t);
    },
  };
}
