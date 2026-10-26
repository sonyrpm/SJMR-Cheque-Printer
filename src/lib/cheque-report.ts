// A printable cheque list (all cheques shown on screen) with totals by bank and by month.
import { STATUS_LABEL, type Cheque } from "../../shared/cheque-rules";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ReportTotals = { key: string; count: number; amounts: Record<string, number> };
/** Counts and amounts of the given cheques grouped by `by(cheque)`, per currency. */
export function totalsBy(rows: Cheque[], by: (c: Cheque) => string): ReportTotals[] {
  const map = new Map<string, ReportTotals>();
  for (const c of rows) {
    const key = by(c);
    const t = map.get(key) ?? { key, count: 0, amounts: {} };
    t.count++;
    t.amounts[c.currency] = (t.amounts[c.currency] ?? 0) + num(c.amount);
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
const amountsText = (t: ReportTotals) => Object.entries(t.amounts).map(([cur, v]) => `${cur} ${fmt(v)}`).join(" + ");

export function reportHtml(rows: Cheque[], opts: { title: string; filter: string; today: string }): string {
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.chequeDate ?? "")}</td><td>${esc(r.chequeNo)}</td><td dir="auto">${esc(r.payee)}</td><td>${esc(r.accountName)}</td><td class="n">${esc(r.currency)} ${fmt(num(r.amount))}</td><td>${esc(STATUS_LABEL[r.status])}${r.statusDate ? " " + esc(r.statusDate) : ""}</td><td dir="auto">${esc(r.note)}</td></tr>`,
    )
    .join("");
  const summary = (title: string, list: ReportTotals[]) =>
    `<h3>${esc(title)}</h3><table class="s"><thead><tr><th>${esc(title.replace("Totals by ", ""))}</th><th>Cheques</th><th class="n">Amount</th></tr></thead><tbody>${list.map((t) => `<tr><td>${esc(t.key)}</td><td>${t.count}</td><td class="n">${esc(amountsText(t))}</td></tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
body{font:11px/1.35 Arial,"Noto Naskh Arabic",sans-serif;margin:14mm;color:#111}h1{font-size:16px;margin:0 0 2px}p{margin:0 0 8px;color:#444}
table{border-collapse:collapse;width:100%;margin-bottom:10px}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}.n{text-align:right;white-space:nowrap}
h3{font-size:12px;margin:12px 0 4px}table.s{width:auto;min-width:50%}tr{page-break-inside:avoid}thead{display:table-header-group}
</style></head><body><h1>${esc(opts.title)}</h1><p>${esc(opts.filter)} · printed ${esc(opts.today)} · ${rows.length} cheque${rows.length === 1 ? "" : "s"}</p>
<table><thead><tr><th>Cheque date</th><th>No.</th><th>Payee</th><th>Bank</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>${body}</tbody></table>
${summary("Totals by Bank", totalsBy(rows, (c) => c.accountName || "-"))}${summary("Totals by Month", totalsBy(rows, (c) => (c.chequeDate ?? "no date").slice(0, 7)))}${summary("Totals by Status", totalsBy(rows, (c) => STATUS_LABEL[c.status]))}
</body></html>`;
}

/** Prints an HTML page through a hidden frame (the Windows print dialog opens). */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("This window cannot print the list.");
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60000);
  }, 250);
}
