// A host for tests: real SQLite (node:sqlite) behind the same database door the Windows shell uses.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function nodeDb(file, { readOnly = false } = {}) {
  const db = new DatabaseSync(file, { readOnly });
  const bind = (params) => (params ?? []).map((v) => (typeof v === "boolean" ? Number(v) : v));
  return {
    async exec(sql, params = []) {
      const r = db.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes) };
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...bind(params)).map((row) => ({ ...row }));
    },
    async close() {
      db.close();
    },
  };
}
export const openNodeDb = async (file, options) => nodeDb(file, options);
export async function memoryStore() {
  const { ChequeStore } = await import("../../core/store.mjs");
  return ChequeStore.open(nodeDb(":memory:"), ":memory:");
}
export const exists = (file) => fs.existsSync(file);
