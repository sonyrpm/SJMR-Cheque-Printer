// Runs the real window (the built files) in Chromium. The window builds its own app core from a host;
// here the host is Node: real SQLite (node:sqlite), a fake printer helper and fake dialogs.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ChequeStore } from "../../core/store.mjs";
import { nodeDb } from "./node-host.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

export async function startHarness({ printerOutputs = [], printers = '[{"name":"HP LaserJet","is_default":true,"default_tray":"Tray 1","trays":[{"name":"Tray 1"},{"name":"Multi-purpose Tray"}]}]', clock = new Date(2026, 10, 1, 9, 0), chosenFile = null, templatePrinters = '[{"name":"HP LaserJet","is_default":true,"papers":[{"name":"A4","width_mm":210,"height_mm":297,"is_a4":true},{"name":"A5","width_mm":148,"height_mm":210,"is_a4":false},{"name":"Letter","width_mm":215.9,"height_mm":279.4,"is_a4":false}]}]', developer = true } = {}) {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("Run `npm run build` first.");
  const server = http.createServer((req, res) => {
    const file = path.join(dist, decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+$/, "index.html"));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const main = nodeDb(":memory:");
  const store = await ChequeStore.open(main, ":memory:");
  const sent = [];
  const outputs = [...printerOutputs];
  const savedPdfs = [];
  const savedData = [];
  const notices = [];
  const dbs = new Map([[1, main]]);
  let nextDb = 2;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ui-"));
  const calls = {
    async openDb(file, options) {
      if (file === ":memory:") return 1;
      dbs.set(nextDb, nodeDb(file, options));
      return nextDb++;
    },
    "db.exec": (id, sql, params) => dbs.get(id).exec(sql, params),
    "db.all": (id, sql, params) => dbs.get(id).all(sql, params),
    async "db.close"(id) {
      if (id !== 1) (await dbs.get(id).close(), dbs.delete(id));
    },
    async runHelper({ args, job, script }) {
      const isList = args.includes("list");
      if (script === "template-print.ps1") {
        if (isList) return { code: 0, out: templatePrinters, err: "" };
        sent.push({ args, job, script });
        return { code: 0, out: `PRINTED_OK|HP LaserJet|${JSON.parse(job).pages.length}`, err: "" };
      }
      if (!isList) sent.push({ args, job });
      return { code: 0, out: isList ? printers : outputs.shift() ?? "PRINTED_OK|HP LaserJet|Tray 1|Landscape", err: "" };
    },
    async savePdf(base64, name) {
      savedPdfs.push(name);
      savedData.push(base64);
      return `C:/Docs/${name}`;
    },
    pickOpen: async () => chosenFile,
    pickSave: async (title, name) => path.join(tmp, name),
    confirm: async () => true,
    async removeFile(file) {
      fs.rmSync(file, { force: true });
    },
    openFolder: async () => null,
    about: async () => ({ version: "test", dataFolder: tmp, portable: true, runtime: "test", developer }),
    replaceDataFile: async () => null,
    async notify(title, body) {
      notices.push([title, body]);
    },
  };
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.exposeFunction("__hostCall", async (name, args) => {
    try {
      return { ok: true, value: (await calls[name](...args)) ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "failed" };
    }
  });
  await page.addInitScript((startMs) => {
    const call = async (name, ...args) => {
      const r = await window.__hostCall(name, args);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    const handle = (id) => ({ exec: (sql, params) => call("db.exec", id, sql, params), all: (sql, params) => call("db.all", id, sql, params), close: () => call("db.close", id) });
    window.__CW_HOST__ = {
      platform: "win32",
      dataFile: ":memory:",
      now: () => new Date(startMs),
      openDb: async (file, options) => handle(await call("openDb", file, options)),
      runHelper: (x) => call("runHelper", x),
      savePdf: (b, n) => call("savePdf", b, n),
      pickOpen: (t, f) => call("pickOpen", t, f),
      pickSave: (t, n, f) => call("pickSave", t, n, f),
      confirm: (m, d) => call("confirm", m, d),
      removeFile: (f) => call("removeFile", f),
      openFolder: () => call("openFolder"),
      about: () => call("about"),
      replaceDataFile: (f) => call("replaceDataFile", f),
      notify: (t, b) => call("notify", t, b),
      onNavigate: () => () => {},
    };
  }, clock.getTime());
  const url = `http://127.0.0.1:${server.address().port}/`;
  return {
    page, store, sent, savedPdfs, savedData, notices, errors, url,
    open: () => page.goto(url),
    shot: async (name) => process.env.CW_SHOTS && (fs.mkdirSync(process.env.CW_SHOTS, { recursive: true }), page.screenshot({ path: path.join(process.env.CW_SHOTS, `${name}.png`) })),
    async close() {
      await browser.close();
      server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
