import { cleanPayeeList } from "./cheque-writer-model.ts";

/** Same rules as Cheque Printer's Import Payees: CSV (first column), TXT (one per line) or JSON. */
function csvFirstColumn(text: string): string[] {
  const rows: string[] = [];
  let field = "",
    first = true,
    quoted = false,
    afterQuote = false;
  const endField = () => {
    if (first) rows.push(field);
    first = false;
    field = "";
    afterQuote = false;
  };
  const endRow = () => {
    endField();
    first = true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += ch;
    } else if (ch === '"' && field === "" && !afterQuote) quoted = true;
    else if (afterQuote && ch !== "," && ch !== "\n" && ch !== "\r")
      throw new Error("The CSV file has text after a closing quote.");
    else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else field += ch;
  }
  if (quoted) throw new Error("The CSV file has an unclosed quote.");
  if (field !== "" || !first || afterQuote) endRow();
  return rows;
}

export function parsePayeeFile(fileName: string, raw: string): string[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lower = fileName.toLowerCase();
  let names: unknown;
  if (lower.endsWith(".json")) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("This is not a valid JSON payee file.");
    }
    names = Array.isArray(data) ? data : (data as { payees?: unknown } | null)?.payees;
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string"))
      throw new Error("JSON must contain a list of payee names.");
  } else if (lower.endsWith(".csv")) {
    const rows = csvFirstColumn(text).filter((row) => row !== "");
    names =
      rows.length &&
      ["payee", "payee name", "ccp_name", "name"].includes(rows[0].trim().toLowerCase())
        ? rows.slice(1)
        : rows;
  } else names = text.split(/\r\n|\r|\n/);
  return cleanPayeeList(names);
}
