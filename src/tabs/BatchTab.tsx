import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Field, Select, Textarea } from "@/components/ui";
import { Tick } from "@/components/bits";
import { api, errorText } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { defaultCalibration, engineRequest, nextChequeNumber, type NativeLayout } from "@/lib/cheque-writer-model";
import { parseBatch } from "@/lib/batch-rows";

type Result = { state: "wait" | "ok" | "fail"; text: string };

/** Prints a list of cheques one after the other with the saved settings of the chosen bank. */
export function BatchTab({ onListChanged }: { onListChanged: () => void }) {
  const { state, reload } = useCw();
  const accounts = state.accounts.filter((a) => a.active);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [text, setText] = useState("");
  const [start, setStart] = useState("");
  const [arabic, setArabic] = useState(false);
  const [capital, setCapital] = useState(true);
  const [addToList, setAddToList] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const [error, setError] = useState("");
  const rows = useMemo(() => parseBatch(text, state.today), [text, state.today]);
  const bad = rows.filter((r) => r.problem).length;
  const account = accounts.find((a) => a.id === accountId);
  const layoutId = account ? state.config.banks[account.id]?.layoutId || "ADCB" : "";
  const layout = state.config.layouts[layoutId] as NativeLayout | undefined;

  async function pickStart(id: string) {
    setAccountId(id);
    setStart((await api.nextChequeNo(id).catch(() => null)) ?? "");
  }
  // The first number is filled in when the tab opens (the next one after the highest in the list).
  useEffect(() => {
    if (accountId) void pickStart(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function numbers(): string[] {
    const out: string[] = [];
    let n = start.trim();
    for (let i = 0; i < rows.length; i++) {
      out.push(n);
      n = nextChequeNumber(n);
    }
    return out;
  }
  async function printAll() {
    if (!account || !layout || running) return;
    setError("");
    let nums: string[];
    try {
      if (!start.trim()) throw new Error("Enter the first cheque number.");
      nums = numbers();
    } catch (e) {
      setError(errorText(e));
      return;
    }
    setRunning(true);
    stopRef.current = false;
    const done: Result[] = rows.map(() => ({ state: "wait", text: "Waiting" }));
    setResults([...done]);
    const cal = structuredClone(state.config.banks[account.id]?.calibration[layoutId] || defaultCalibration(layoutId));
    for (let i = 0; i < rows.length; i++) {
      if (stopRef.current) {
        done[i] = { state: "fail", text: "Stopped" };
        continue;
      }
      const r = rows[i];
      try {
        const printed = arabic && r.arabic ? r.arabic : r.payee;
        const values = { number: nums[i], payee: printed, amount: r.amount, date: r.date, blankDate: false, crossed: true, crossing: 1 as const, noBearer: false, payeeCaps: capital && !arabic, style: arabic ? ("AR" as const) : ("spelled_fils" as const), wording: null };
        const request = engineRequest(layout, cal, values, { id: account.id, code: "", name: account.name, bankNo: account.bankNo }, account.currency || "AED");
        const result = await api.output({ action: "direct", request, list: addToList ? { accountId: account.id, layoutId } : null });
        if (result.cancelled) {
          done[i] = { state: "fail", text: "Cancelled: the list stopped here." };
          stopRef.current = true;
        } else done[i] = { state: "ok", text: `Printed as ${nums[i]}` };
      } catch (e) {
        done[i] = { state: "fail", text: errorText(e) };
        stopRef.current = true; // a failed cheque stops the list, so no cheque leaf is wasted
      }
      setResults([...done]);
    }
    stopRef.current = false;
    setRunning(false);
    onListChanged();
    void reload();
  }
  if (!accounts.length) return <Alert tone="warn">Add a bank account first (Banks &amp; Layouts).</Alert>;
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Batch printing</h2>
        <p className="text-xs text-muted">Paste one cheque on each line: <strong>Payee, Amount, Date</strong> (date is optional; today is used). Copy the lines from Excel or type them. Add an Arabic name as a fourth column to print Arabic. The bank&apos;s saved printer, tray and alignment are used. If one cheque fails, the list stops, so no cheque leaf is wasted.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Bank account">
            <Select aria-label="Bank account" value={accountId} onChange={(e) => void pickStart(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="First cheque number">
            <input aria-label="First cheque number" className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px]" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end gap-1">
            <Tick label="Arabic cheques (use the Arabic name)" value={arabic} onChange={setArabic} />
            <Tick label="Add each cheque to the list" value={addToList} onChange={setAddToList} />
          </div>
        </div>
        <Field label="Cheques">
          <Textarea aria-label="Batch cheques" dir="auto" rows={7} placeholder={"Al Noor Trading, 1250.50, 15/11/2026\nGulf Star Contracting, 3,000, 20/11/2026"} value={text} onChange={(e) => { setText(e.target.value); setResults([]); }} />
        </Field>
        {!arabic && <Tick label="Payee in capital letters" value={capital} onChange={setCapital} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!rows.length || !!bad || running || !layout} onClick={() => void printAll()}>Print {rows.length || ""} cheque{rows.length === 1 ? "" : "s"}</Button>
          {running && <Button variant="danger" onClick={() => { stopRef.current = true; }}>Stop after this cheque</Button>}
          <span className="text-xs text-muted">{rows.length} line{rows.length === 1 ? "" : "s"}{bad ? ` · ${bad} need fixing` : ""}</span>
        </div>
      </Card>
      {!!rows.length && (
        <div className="overflow-auto rounded-xl border border-border bg-surface">
          <table className="cw-table w-full text-[13px]">
            <thead><tr><th>#</th><th>Payee</th><th className="text-right">Amount</th><th>Date</th><th>Cheque no.</th><th>Check</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                let no = "";
                try {
                  no = start.trim() ? numbers()[i] : "";
                } catch {
                  no = "?";
                }
                const res = results[i];
                return (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td dir="auto">{arabic && r.arabic ? r.arabic : r.payee}</td>
                    <td className="text-right tabular-nums">{r.amount}</td>
                    <td>{r.date}</td>
                    <td>{no}</td>
                    <td className={r.problem || res?.state === "fail" ? "text-danger" : res?.state === "ok" ? "text-success" : "text-muted"}>{r.problem || res?.text || (arabic && !r.arabic ? "No Arabic name: English is printed" : "Ready")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
