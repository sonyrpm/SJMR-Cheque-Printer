import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as core from "../shared/cheque-core.mjs";

const layouts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../shared/bank-layouts.json"), "utf8"));
const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/cheque-core-golden.json"), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const canon = (v) => (typeof v === "number" ? v.toFixed(2) : Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)])) : v);

test("the printing engine gives the same PDF bytes and printer job as the original Python Cheque Printer", () => {
  assert.ok(golden.cases.length >= 100);
  let refused = 0;
  for (const [i, c] of golden.cases.entries()) {
    const input = { template: layouts[c.tid], account: c.account, cheque: c.cheque, action: "pdf" };
    if (c.error) {
      assert.throws(() => core.prepare(input), (e) => e.message === c.error, `case ${i}`);
      refused++;
      continue;
    }
    const { template, data, account } = core.prepare(input);
    assert.equal(sha(core.chequePdf(template, data, account)), c.pdfSha256, `PDF of case ${i}`);
    const job = core.directJob(template, data, account, c.mode, c.orientation);
    assert.equal(sha(JSON.stringify(canon({ lines: job.lines, texts: job.texts }))), c.directSha256, `printer job of case ${i}`);
  }
  assert.ok(refused >= 1, "a payee that does not fit is refused, never cut");
});
