import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormDialog, Input, Select } from "@/components/ui";
import { Tick } from "@/components/bits";
import { api, errorText, type Account } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { chequeFieldLabel, type NativeLayout } from "@/lib/cheque-writer-model";

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function BanksTab() {
  const { state, reload, setConfig } = useCw();
  const { config, accounts } = state;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [layoutId, setLayoutId] = useState(Object.keys(config.layouts)[0]);
  const [layout, setLayout] = useState<NativeLayout | null>(() => structuredClone(config.layouts[Object.keys(config.layouts)[0]]));
  const [isNew, setIsNew] = useState(false);
  const [field, setField] = useState("mmPayee");
  const [importMode, setImportMode] = useState("skip");
  const [deleteId, setDeleteId] = useState("");
  const [busy, setBusy] = useState(false);
  // Field positions, layout import / export are developer options: no button, Ctrl+Shift+D switches them on or off on this PC.
  const [devAllowed, setDevAllowed] = useState(false);
  useEffect(() => { api.about().then((a) => setDevAllowed(a.developer === true)).catch(() => undefined); }, []);
  const [wanted, setAdvanced] = useState(() => {
    try { return localStorage.getItem("cw.developer") === "1"; } catch { return false; }
  });
  const advanced = devAllowed && wanted;
  useEffect(() => {
    if (!devAllowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d")) return;
      e.preventDefault();
      setAdvanced((was) => {
        try { localStorage.setItem("cw.developer", was ? "0" : "1"); } catch { /* the choice still works for this session */ }
        return !was;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [devAllowed]);
  useEffect(() => {
    if (!isNew && config.layouts[layoutId]) setLayout(structuredClone(config.layouts[layoutId]));
  }, [config, layoutId, isNew]);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const usedBy = (id: string) => (config.banks[id]?.layoutId ? config.layouts[config.banks[id].layoutId]?.display_name || config.banks[id].layoutId : "—");
  async function importLayouts(file?: File) {
    if (!file) return;
    await act(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error("Choose a layout JSON under 20 MB.");
      let data = JSON.parse((await file.text()).replace(/^﻿/, ""));
      if (data.format === "sjmr-bank-layouts") {
        if (data.version !== 1) throw new Error("Unsupported layout version.");
        data = data.layouts;
      }
      if (data.id && data.fields) data = { [data.id]: data };
      setConfig(await api.saveDesign({ kind: "layouts", revision: config.revision, layouts: data, replace: importMode === "replace" }));
      setNotice("Layouts imported. Select a saved layout to use its measurements.");
    });
  }
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Bank accounts</h2>
          <Button onClick={() => setEdit({ name: "", bankNo: "", currency: "AED", active: true })}>Add bank account</Button>
        </div>
        <div className="overflow-auto rounded-lg border border-border">
          <table className="cw-table w-full text-[13px]">
            <thead><tr><th>Name</th><th>Account number</th><th>Currency</th><th>Layout</th><th>Status</th><th /></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.name}</td><td>{a.bankNo}</td><td>{a.currency}</td><td>{usedBy(a.id)}</td>
                  <td>{a.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="text-right">
                    <Button variant="secondary" className="min-h-7 px-2 text-xs" onClick={() => setEdit(a)}>Edit</Button>{" "}
                    <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => act(async () => { await api.deleteAccount(a.id); await reload(); setNotice("Bank account deleted."); })}>Delete</Button>
                  </td>
                </tr>
              ))}
              {!accounts.length && <tr><td colSpan={6} className="p-4 text-center text-muted">No bank accounts yet. Add your first one to start writing cheques.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">A bank account that has cheques in the list cannot be deleted: mark it inactive instead. Calibration is saved per bank account and layout in Write &amp; Print.</p>
      </Card>
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Bank layout library · {Object.keys(config.layouts).length} layouts{advanced && <span className="ml-2 text-xs font-normal text-muted">(developer options on · Ctrl+Shift+D turns them off)</span>}</h2>
        <div className="flex flex-wrap gap-2">
          <Field label="Layout" className="w-72">
            <Select aria-label="Layout" value={isNew ? "" : layoutId} onChange={(e) => { setIsNew(false); setLayoutId(e.target.value); }}>
              {isNew && <option value="">(new layout)</option>}
              {Object.values(config.layouts).map((l) => <option key={l.id} value={l.id}>{l.display_name || l.id}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="secondary" disabled={!layout} onClick={() => { if (layout) { setLayout({ ...structuredClone(layout), id: `CUSTOM_${Date.now()}`, display_name: `${layout.display_name || layout.id} copy` }); setIsNew(true); } }}>Create new layout</Button>
            <Button disabled={!layout || busy} onClick={() => layout && act(async () => {
              if (isNew && config.layouts[layout.id]) throw new Error("Choose a new layout ID.");
              setConfig(await api.saveDesign({ kind: "layouts", revision: config.revision, layouts: { [layout.id]: layout }, replace: !isNew }));
              setLayoutId(layout.id); setIsNew(false); setNotice("Bank layout saved.");
            })}>{isNew ? "Save new layout" : "Save layout edits"}</Button>
            <Button variant="danger" disabled={isNew || !layout} onClick={() => setDeleteId(layout?.id || "")}>Delete layout</Button>
            {advanced && <>
            <Button variant="secondary" disabled={!layout} onClick={() => layout && download(`SJMR-${layout.id}.json`, JSON.stringify({ format: "sjmr-bank-layouts", version: 1, layouts: { [layout.id]: layout } }, null, 2), "application/json")}>Export selected</Button>
            <Button variant="secondary" onClick={() => download("SJMR-Bank-Layouts.json", JSON.stringify({ format: "sjmr-bank-layouts", version: 1, layouts: config.layouts }, null, 2), "application/json")}>Export all</Button>
            </>}
          </div>
        </div>
        {layout && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {(advanced || isNew) && <Field label="Layout ID"><Input aria-label="Layout ID" disabled={!isNew} value={layout.id} onChange={(e) => setLayout({ ...layout, id: e.target.value })} /></Field>}
              <Field label="Bank / layout name"><Input aria-label="Bank / layout name" value={layout.display_name || layout.id} onChange={(e) => setLayout({ ...layout, display_name: e.target.value })} /></Field>
            </div>
            {advanced && <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Field label="Edit layout field">
                <Select aria-label="Edit layout field" value={field} onChange={(e) => setField(e.target.value)}>
                  {Object.keys(layout.fields).map((key) => <option key={key} value={key}>{chequeFieldLabel(key)}</option>)}
                </Select>
              </Field>
              {([["left_mm", "Left (mm)"], ["top_mm", "Top (mm)"], ["width_mm", "Field width (mm)"], ["height_mm", "Field height (mm)"]] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input aria-label={label} type="number" step={0.1} disabled={!layout.fields[field]} value={Number(layout.fields[field]?.[key] || 0)}
                    onChange={(e) => setLayout({ ...layout, fields: { ...layout.fields, [field]: { ...layout.fields[field], [key]: e.target.valueAsNumber } } })} />
                </Field>
              ))}
            </div>}
          </>
        )}
        {advanced && <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Import existing IDs">
            <Select aria-label="Import existing IDs" value={importMode} onChange={(e) => setImportMode(e.target.value)}>
              <option value="skip">Skip existing layouts</option>
              <option value="replace">Replace matching layouts</option>
            </Select>
          </Field>
          <Field label="Import bank layouts JSON">
            <Input aria-label="Import bank layouts JSON" type="file" accept="application/json,.json" onChange={(e) => { void importLayouts(e.target.files?.[0]); e.target.value = ""; }} />
          </Field>
        </div>}
      </Card>
      {edit && <AccountDialog initial={edit} onClose={() => setEdit(null)} onSaved={async (text) => { setEdit(null); await reload(); setNotice(text); }} />}
      {deleteId && (
        <FormDialog title="Delete bank layout" busy={busy} onClose={() => setDeleteId("")}
          footer={<><Button variant="secondary" onClick={() => setDeleteId("")}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => act(async () => { const next = await api.saveDesign({ kind: "delete", revision: config.revision, id: deleteId }); setConfig(next); setDeleteId(""); setLayoutId(Object.keys(next.layouts)[0]); setNotice("Unused layout deleted."); })}>Delete layout</Button></>}>
          <p>Delete {config.layouts[deleteId]?.display_name || deleteId}? A layout used by a bank account cannot be deleted.</p>
        </FormDialog>
      )}
    </div>
  );
}

function AccountDialog({ initial, onClose, onSaved }: { initial: Partial<Account>; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [name, setName] = useState(initial.name ?? "");
  const [bankNo, setBankNo] = useState(initial.bankNo ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "AED");
  const [active, setActive] = useState(initial.active !== false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <FormDialog title={initial.id ? "Edit bank account" : "Add bank account"} busy={busy} onClose={onClose}
      footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await api.saveAccount({ id: initial.id, name, bankNo, currency, active }); await onSaved("Bank account saved."); }
          catch (e) { setError(errorText(e)); setBusy(false); }
        }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Account name (for example ADCB Main)"><Input aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Account number / IBAN (printed on the guide only)"><Input aria-label="Account number" value={bankNo} onChange={(e) => setBankNo(e.target.value)} /></Field>
        <Field label="Currency (3 letters)"><Input aria-label="Currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
        <Tick label="Active (shown in Write & Print)" value={active} onChange={setActive} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </FormDialog>
  );
}
