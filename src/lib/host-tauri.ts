// The Windows shell (Tauri): the few things a web page cannot do are Rust commands (src-tauri/src/lib.rs);
// dialogs, notifications and start-up use the official Tauri plugins.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Db, Host } from "../../core/index.mjs";

type Filters = { name: string; extensions: string[] }[];
type Info = { version: string; dataFolder: string; dataFile: string; portable: boolean; runtime: string; developer: boolean };

function database(id: number): Db {
  return {
    exec: (sql, params = []) => invoke("db_exec", { id, sql, params }),
    all: (sql, params = []) => invoke("db_all", { id, sql, params }),
    close: () => invoke("db_close", { id }),
  };
}

export async function tauriHost(): Promise<Host> {
  const info = await invoke<Info>("app_info");
  return {
    platform: "win32",
    dataFile: info.dataFile,
    async openDb(path, { readOnly }) {
      return database(await invoke<number>("db_open", { path, readOnly }));
    },
    async loadFont() {
      const reply = await fetch("fonts/NotoNaskhArabic-Regular.ttf");
      if (!reply.ok) throw new Error("The Arabic font file is missing from the program.");
      return new Uint8Array(await reply.arrayBuffer());
    },
    runHelper: ({ args, job, visible, timeoutMs, script }) => invoke("run_helper", { args, job: job ?? null, visible, timeoutMs, script: script ?? null }),
    async savePdf(base64, name) {
      const file = await save({ title: "Save cheque PDF", defaultPath: name, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!file) return null;
      await invoke("write_base64", { path: file, base64 });
      return file;
    },
    async pickOpen(title: string, filters: Filters) {
      const file = await open({ title, multiple: false, directory: false, filters });
      return typeof file === "string" ? file : null;
    },
    pickSave: async (title: string, name: string, filters: Filters) => (await save({ title, defaultPath: name, filters })) ?? null,
    confirm: (message, detail) => ask(`${message}\n\n${detail}`, { title: "SJMR Cheque Writer", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" }),
    removeFile: (path) => invoke("remove_file", { path }),
    openFolder: () => invoke("open_data_folder"),
    about: async () => ({ version: info.version, dataFolder: info.dataFolder, portable: info.portable, runtime: info.runtime, developer: info.developer }),
    replaceDataFile: (source) => invoke("replace_data_file", { source }),
    async notify(title, body) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    },
    async applyAlertSettings(settings, tip) {
      const s = settings as { startWithWindows?: boolean; keepInTray?: boolean };
      try {
        const on = await isEnabled();
        if (s.startWithWindows && !on) await enable();
        if (!s.startWithWindows && on) await disable();
      } catch {
        // Some systems do not let a program register itself for start-up; the setting then has no effect.
      }
      await invoke("set_tray", { keepInTray: !!s.keepInTray, tip });
    },
    setTip: (text) => invoke("set_tray", { keepInTray: null, tip: text }),
    onNavigate(callback) {
      let stop: (() => void) | null = null;
      let gone = false;
      void listen<string>("cw:navigate", (event) => callback(event.payload)).then((off) => (gone ? off() : (stop = off)));
      return () => {
        gone = true;
        stop?.();
      };
    },
  };
}
