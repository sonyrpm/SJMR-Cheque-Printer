// The release record must satisfy the rules the website Worker applies (SJMR Accounting licensing/src/cheque.ts parseChequeRelease).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PORTABLE_FILE, SETUP_FILE, buildRelease } from "../scripts/make-release.mjs";

const exe = (size, fill = 7) => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(size - 2, fill)]);
function folder(setup = exe(1_300_000), portable = exe(1_700_000, 9)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-release-"));
  if (setup) fs.writeFileSync(path.join(dir, SETUP_FILE), setup);
  if (portable) fs.writeFileSync(path.join(dir, PORTABLE_FILE), portable);
  return dir;
}
// The Worker's rules, repeated here.
const workerAccepts = (r) =>
  [[r.setup, SETUP_FILE], [r.portable, PORTABLE_FILE]].every(([f, name]) => f.file === name && /^[0-9a-f]{64}$/.test(f.sha256) && Number.isInteger(f.size) && f.size >= 1_000_000) &&
  /^[0-9A-Za-z._+-]+$/.test(r.version) &&
  !Number.isNaN(Date.parse(r.built)) &&
  r.notes.length <= 600;

test("the record has the fixed file names, real sizes and hashes, and passes the Worker's rules", () => {
  const dir = folder();
  try {
    const r = buildRelease({ dir, version: "2.1.0", notes: "First free release", now: new Date("2026-10-26T09:00:00Z") });
    assert.equal(r.built, "2026-10-26T09:00:00.000Z");
    assert.equal(r.setup.file, "SJMR_Cheque_Writer_Setup.exe");
    assert.equal(r.portable.file, "SJMR_Cheque_Writer_Portable.exe");
    assert.equal(r.setup.size, 1_300_000);
    assert.notEqual(r.setup.sha256, r.portable.sha256);
    assert.ok(workerAccepts(r));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("notes are one line of at most 600 characters; a missing, tiny or non-Windows file stops the release", () => {
  const dir = folder();
  try {
    const r = buildRelease({ dir, version: "2.1.0", notes: `line one\r\nline two ${"x".repeat(700)}` });
    assert.ok(!/[\r\n]/.test(r.notes));
    assert.equal(r.notes.length, 600);
    assert.throws(() => buildRelease({ dir, version: "bad version!" }), /version/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const [setup, portable, message] of [[null, exe(1_700_000), /Setup\.exe is missing/], [exe(1_300_000), exe(500), /too small/], [Buffer.alloc(1_300_000, 1), exe(1_700_000), /not a Windows program/]]) {
    const d = folder(setup, portable);
    try {
      assert.throws(() => buildRelease({ dir: d, version: "2.1.0" }), message);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
});
