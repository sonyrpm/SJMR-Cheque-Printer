import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { Tick } from "@/components/bits";
import { api, errorText, type ImportReport } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import type { AlertSettings } from "../../shared/cheque-rules";

export function SettingsTab({ onChanged }: { onChanged: () => void }) {
  const { state, reload } = useCw();
  const [alerts, setAlerts] = useState<AlertSettings>(state.alerts);
  const [about, setAbout] = useState<Awaited<ReturnType<typeof api.about>> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  useEffect(() => {
    api.about().then(setAbout).catch(() => undefined);
  }, []);
  async function run(task: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const set = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => setAlerts((old) => ({ ...old, [key]: value }));
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <div className="space-y-3 lg:col-span-2">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
      </div>
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Alerts for coming cheques</h2>
        <Tick label="Show alerts" value={alerts.enabled} onChange={(v) => set("enabled", v)} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Coming cheque: alert this many days before the cheque date">
            <Input aria-label="Days before" type="number" min={0} max={60} value={alerts.daysAhead} onChange={(e) => set("daysAhead", e.target.valueAsNumber)} />
          </Field>
          <Field label="Not cleared: alert this many days after the cheque date">
            <Input aria-label="Days after" type="number" min={0} max={90} value={alerts.overdueAfterDays} onChange={(e) => set("overdueAfterDays", e.target.valueAsNumber)} />
          </Field>
        </div>
        <Tick label="Also show a Windows notification (once a day for each cheque)" value={alerts.notify} onChange={(v) => set("notify", v)} disabled={!alerts.enabled} />
        <Tick label="Keep running in the tray when the window is closed, so alerts still appear" value={alerts.keepInTray} onChange={(v) => set("keepInTray", v)} />
        <Tick label="Start with Windows (minimized to the tray)" value={alerts.startWithWindows} onChange={(v) => set("startWithWindows", v)} />
        <div>
          <Button onClick={() => void run(async () => { await api.saveAlerts(alerts); await reload(); onChanged(); setNotice("Alert settings saved."); })}>Save alert settings</Button>
        </div>
        <p className="text-xs text-muted">Alerts cover Pending cheques only. A cleared, returned or cancelled cheque never raises an alert.</p>
      </Card>
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Data</h2>
        <p className="text-xs text-muted break-all">Data file: {about?.dataFolder ?? "…"} {about?.portable ? "(portable: stays beside the program)" : ""}</p>
        <p className="text-xs text-muted">{state.summary.accounts} bank account(s) · {state.summary.cheques} cheque(s) in the list · {state.summary.payees} payee(s)</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void run(async () => { const f = await api.dataBackup(); if (f) setNotice(`Copy saved: ${f}`); })}>Save a copy of the data</Button>
          <Button variant="secondary" onClick={() => void run(async () => { await api.dataRestore(); })}>Restore from a copy</Button>
          <Button variant="secondary" onClick={() => void run(async () => { await api.openDataFolder(); })}>Open data folder</Button>
        </div>
      </Card>
      <Card className="space-y-2 lg:col-span-2">
        <h2 className="text-sm font-semibold">Import from the old Cheque Printer</h2>
        <p className="text-xs text-muted">Choose the old <strong>cheque_writer.db</strong>. Bank accounts, calibration, layouts, cheques (cleared and voided cheques keep their status) and payees are brought in. The old file is only read, never changed. Importing twice adds nothing twice.</p>
        <div><Button variant="secondary" onClick={() => void run(async () => { const r = await api.importOld(); if (r) { setReport(r); await reload(); onChanged(); } })}>Choose old file…</Button></div>
        {report && (
          <Alert tone={report.warnings.length ? "warn" : "success"}>
            Imported {report.accounts} bank account(s) ({report.accountsReused} already here), {report.cheques} cheque(s) ({report.chequesSkipped} already in the list), {report.layouts} layout(s), {report.payees} payee(s).
            {report.ledgerEntries ? ` ${report.ledgerEntries} deposit/withdrawal ledger entries were not imported.` : ""}
            {report.warnings.map((w) => <div key={w}>{w}</div>)}
          </Alert>
        )}
      </Card>
      <Card className="lg:col-span-2">
        <p className="text-xs text-muted">SJMR Cheque Writer {about?.version ?? ""} · printing engine shared with SJMR Accounting · info@sjmrsoft.com</p>
      </Card>
    </div>
  );
}
