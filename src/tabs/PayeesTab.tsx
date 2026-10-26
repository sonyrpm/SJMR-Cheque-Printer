import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { parsePayeeFile } from "@/lib/cheque-payee-list";

export function PayeesTab() {
  const { state, reload } = useCw();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = useMemo(() => state.payees.filter((p) => p.toLowerCase().includes(q.trim().toLowerCase())), [state.payees, q]);
  async function run(task: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await task();
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }
  function exportList() {
    const url = URL.createObjectURL(new Blob([state.payees.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Payees.txt";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Payee list · {state.payees.length}</h2>
        <p className="text-xs text-muted">Names saved here are offered while writing a cheque. A payee is added automatically when a cheque is added to the list.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a payee" className="min-w-56 flex-1"><Input aria-label="New payee" maxLength={500} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void run(async () => { await api.addPayee(name); setName(""); }); }} /></Field>
          <Button disabled={!name.trim()} onClick={() => void run(async () => { await api.addPayee(name); setName(""); })}>Add</Button>
          <Field label="Import payee file (JSON, CSV or TXT)" className="w-72">
            <Input aria-label="Import payee file" type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void run(async () => {
                  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a payee file under 10 MB.");
                  const names = parsePayeeFile(file.name, await file.text());
                  if (!names.length) throw new Error("The file has no payee names.");
                  const result = await api.importPayees(names);
                  setNotice(`${result.added} new payee name(s) added; ${names.length - result.added} were already in the list.`);
                });
              }} />
          </Field>
          <Button variant="secondary" disabled={!state.payees.length} onClick={exportList}>Export</Button>
        </div>
        <Field label="Search"><Input aria-label="Search payees" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <div className="max-h-[calc(100vh-24rem)] overflow-auto rounded-lg border border-border">
          <table className="cw-table w-full text-[13px]">
            <tbody>
              {list.slice(0, 500).map((p) => (
                <tr key={p}><td>{p}</td><td className="w-20 text-right"><Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => void run(async () => { await api.removePayee(p); })}>Remove</Button></td></tr>
              ))}
              {!list.length && <tr><td className="p-4 text-center text-muted">{state.payees.length ? "No payee matches." : "No payees yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        {list.length > 500 && <p className="text-xs text-muted">Showing the first 500 of {list.length}. Search to narrow the list.</p>}
      </Card>
    </div>
  );
}
