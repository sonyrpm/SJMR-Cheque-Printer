// Rows for batch printing: one cheque per line, "payee, amount[, date[, Arabic name]]" (comma, tab or semicolon).
export type BatchRow = { line: number; payee: string; amount: string; date: string; arabic: string; problem: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function toIso(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (ISO.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "?";
}
export function parseBatch(text: string, defaultDate: string): BatchRow[] {
  const rows: BatchRow[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const parts = (line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : splitCsv(line)).map((p) => p.trim());
    const [payee = "", amountText = "", dateText = "", arabic = ""] = parts;
    const amount = amountText.replace(/[^0-9.,-]/g, "").replaceAll(",", "");
    const date = toIso(dateText) || defaultDate;
    let problem = "";
    if (index === 0 && /^payee$/i.test(payee) && !Number(amount)) return; // header row
    if (!payee) problem = "No payee name.";
    else if (!(Number(amount) > 0)) problem = "Amount must be a positive number.";
    else if (date === "?" || Number.isNaN(Date.parse(date))) problem = "Date not understood (use DD/MM/YYYY or YYYY-MM-DD).";
    rows.push({ line: index + 1, payee, amount, date, arabic, problem });
  });
  return rows;
}
// Commas inside "double quotes" stay part of the value; a thousands comma in the amount is allowed.
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  // "Name, 1,250.50, 2026-11-03": a split amount ("1" and "250.50") is joined back.
  if (out.length >= 3 && /^\s*\d{1,3}\s*$/.test(out[1]) && /^\s*\d{3}(\.\d+)?\s*$/.test(out[2])) out.splice(1, 2, `${out[1].trim()},${out[2].trim()}`);
  return out;
}
