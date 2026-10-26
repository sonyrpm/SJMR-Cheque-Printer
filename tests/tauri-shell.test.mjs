// The Windows shell cannot run here, so its wiring is pinned: every command the window calls exists in
// Rust and has its permission, the WebView2 safety nets are there, and no Electron is left.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const rust = read("src-tauri/src/lib.rs") + read("src-tauri/src/db.rs") + read("src-tauri/src/helper.rs");

test("every Rust command the window calls is registered", () => {
  const js = read("src/lib/host-tauri.ts") + read("src/boot.ts");
  const called = [...js.matchAll(/(?<![.\w])invoke(?:<[^>]*>)?\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 12, "found the calls");
  const handler = rust.slice(rust.indexOf("generate_handler!"), rust.indexOf("])", rust.indexOf("generate_handler!")));
  for (const name of new Set(called)) assert.ok(new RegExp(`\\b${name}\\b`).test(handler), `${name} is registered in generate_handler`);
});

test("plugin calls are allowed by the window's capability", () => {
  const caps = JSON.parse(read("src-tauri/capabilities/default.json")).permissions;
  for (const need of ["dialog:allow-open", "dialog:allow-save", "dialog:allow-ask", "notification:default", "autostart:allow-enable", "autostart:allow-disable", "autostart:allow-is-enabled", "core:event:default"])
    assert.ok(caps.includes(need), need);
});

test("WebView2 is fetched by itself: installer setting and the portable first-start check", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
  assert.equal(conf.identifier, "com.sonyrpm.sjmrchequewriter");
  const web = read("src-tauri/src/webview2.rs");
  assert.match(web, /go\.microsoft\.com\/fwlink\/p\/\?LinkId=2124703/);
  assert.match(rust, /webview2::ensure_or_exit\(\)/);
});

test("data stays where the Electron version kept it, and the printing helper is part of the program", () => {
  const lib = read("src-tauri/src/lib.rs");
  assert.match(lib, /SJMR Cheque Writer Data/);
  assert.match(lib, /join\("SJMR Cheque Writer"\)\.join\("data"\)/);
  assert.match(lib, /cheque_writer_data\.db/);
  const helper = read("src-tauri/src/helper.rs");
  assert.match(helper, /include_bytes!\("\.\.\/\.\.\/shared\/direct\/cheque-direct\.ps1"\)/);
  assert.match(helper, /include_bytes!\("\.\.\/\.\.\/shared\/direct\/ChequeDirectPrinter\.cs"\)/);
  assert.match(helper, /include_bytes!\("\.\.\/\.\.\/shared\/direct\/template-print\.ps1"\)/);
  assert.match(helper, /include_bytes!\("\.\.\/\.\.\/shared\/direct\/TemplatePrinter\.cs"\)/);
  assert.match(helper, /Some\("template-print\.ps1"\)/, "only the two known scripts can be run");
  assert.match(read("src/lib/host-tauri.ts"), /script: script \?\? null/);
});

test("a picture can be dropped on the window (HTML5 drag and drop must stay on)", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.app.windows[0].dragDropEnabled, false);
});

test("no Electron is left in the project", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies.electron, undefined);
  assert.equal(pkg.devDependencies["electron-builder"], undefined);
  assert.equal(fs.existsSync(path.join(root, "electron")), false);
  for (const file of fs.readdirSync(path.join(root, ".github/workflows"))) assert.doesNotMatch(read(`.github/workflows/${file}`), /electron-builder|dist:portable.*electron/);
});

test("the window's database door matches what the store sends (positional parameters, rows as objects)", () => {
  const db = read("src-tauri/src/db.rs");
  assert.match(db, /params_from_iter/);
  assert.match(db, /column_names\(\)/);
  assert.match(db, /statement\.column_count\(\) > 0/, "pragma statements that return rows still run");
});
