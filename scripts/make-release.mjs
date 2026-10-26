// Writes the release record for the website download page: fixed file names, sizes, SHA-256, version, build time, notes.
// The Worker (licensing/src/cheque.ts in SJMR Accounting) accepts only exactly these two file names.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SETUP_FILE = "SJMR_Cheque_Writer_Setup.exe";
export const PORTABLE_FILE = "SJMR_Cheque_Writer_Portable.exe";

const fileInfo = (dir, name) => {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error(`${name} is missing in ${dir}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length < 1_000_000) throw new Error(`${name} is too small (${bytes.length} bytes): the build is not complete`);
  if (bytes.subarray(0, 2).toString("latin1") !== "MZ") throw new Error(`${name} is not a Windows program`);
  return { file: name, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
};

export function buildRelease({ dir, version, notes = "", now = new Date() }) {
  if (!/^[0-9A-Za-z._+-]{1,40}$/.test(version)) throw new Error("The version is not valid.");
  return {
    version,
    built: now.toISOString(),
    notes: String(notes).replace(/[\r\n]+/g, " ").trim().slice(0, 600),
    setup: fileInfo(dir, SETUP_FILE),
    portable: fileInfo(dir, PORTABLE_FILE),
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("make-release.mjs")) {
  const [dir, notes = ""] = process.argv.slice(2);
  if (!dir) throw new Error("Usage: node scripts/make-release.mjs <folder with the two exe files> [notes]");
  const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;
  const record = buildRelease({ dir, version, notes });
  fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${record.setup.sha256}  ${SETUP_FILE}\n${record.portable.sha256}  ${PORTABLE_FILE}\n`);
  console.log(`Release ${record.version}: setup ${record.setup.size} bytes, portable ${record.portable.size} bytes`);
}
