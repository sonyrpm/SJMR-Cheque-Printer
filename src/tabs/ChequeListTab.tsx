import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Field, FormDialog, Input, Select } from "@/components/ui";
import { Chip, Tick } from "@/components/bits";
import { api, errorText } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { STATUS_LABEL, alertSummary, dueInfo, type Cheque, type Status } from "../../shared/cheque-rules";
import { printHtml, reportHtml } from "@/lib/cheque-report";
import { defaultCalibration, engineRequest, type NativeLayout } from "@/lib/cheque-writer-model";

type Filter = "all" | "pending" | "coming" | "attention" | "cleared" | "returned" | "cancelled";
const CHIPS: [Filter, string][] = [
  ["all", "All"],
  ["pending", "Pending"],
  ["coming", "Coming"],
  ["attention", "Needs attention"],
  ["cleared", "Cleared"],
  ["returned", "Returned"],
  ["cancelled", "Cancelled"],
];
const TONE: Record<Status, "muted" | "success" | "warn" | "danger"> = { pending: "warn", cleared: "success", returned: "danger", cancelled: "muted" };
const money = (amount: string, currency: string) => `${currency} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

function csv(rows: Cheque[]) {
  const cell = (v: unknown) => {
    let text = String(v ?? "");
    if (/^[=+\-@]/.test(text.trim())) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const head = ["Cheque date", "Cheque no", "Payee", "Bank", "Amount", "Currency", "Status", "Status date", "Reason", "Note", "Issued on"];
  const lines = rows.map((r) => [r.chequeDate ?? "", r.chequeNo, r.payee, r.accountName ?? "", r.amount, r.currency, STATUS_LABEL[r.status], r.statusDate ?? "", r.reason, r.note, r.issuedOn]);
  return "﻿" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n");
}

export function ChequeListTab({ initialFilter, onChanged }: { initialFilter: string; onChanged: () => void }) {
  const { state } = useCw();
  const [rows, setRows] = useState<Cheque[] | null>(null);
  const [filter, setFilter] = useState<Filter>(CHIPS.some(([id]) => id === initialFilter) ? (initialFilter as Filter) : "all");
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mark, setMark] = useState<{ ids: string[]; to: Status } | null>(null);
  const [details, setDetails] = useState<Cheque | null>(null);
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void> } | null>(null);
  const today = state.today;
  const alerts = state.alerts;

  const load = useCallback(async () => {
    try {
      setRows(await api.cheques({}));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    const summary = alertSummary(all, today, alerts);
    return {
      all: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      coming: all.filter((r) => r.status === "pending" && r.chequeDate && r.chequeDate >= today).length,
      attention: summary.count,
      cleared: all.filter((r) => r.status === "cleared").length,
      returned: all.filter((r) => r.status === "returned").length,
      cancelled: all.filter((r) => r.status === "cancelled").length,
    } as Record<Filter, number>;
  }, [rows, today, alerts]);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "coming" && !(r.status === "pending" && r.chequeDate && r.chequeDate >= today)) return false;
      if (filter === "attention" && !["today", "soon", "overdue"].includes(dueInfo(r, today, alerts).kind)) return false;
      if (!["all", "coming", "attention"].includes(filter) && r.status !== filter) return false;
      if (accountId && r.accountId !== accountId) return false;
      if (from && (!r.chequeDate || r.chequeDate < from)) return false;
      if (to && (!r.chequeDate || r.chequeDate > to)) return false;
      return !text || `${r.chequeNo} ${r.payee} ${r.amount} ${r.note} ${r.reason}`.toLowerCase().includes(text);
    });
  }, [rows, filter, q, accountId, from, to, today, alerts]);
  const pendingTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of shown) if (r.status === "pending") totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.amount));
    return [...totals].map(([currency, total]) => money(total.toFixed(2), currency));
  }, [shown]);

  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const picked = shown.filter((r) => selected.has(r.id)).map((r) => r.id);

  async function apply(ids: string[], to: Status, date: string, reason: string) {
    setError("");
    try {
      const before = (rows ?? []).filter((r) => ids.includes(r.id));
      if (ids.length === 1) await api.setStatus({ id: ids[0], to, date, reason });
      else await api.setStatusMany({ ids, to, date, reason });
      setNotice(`${ids.length} cheque${ids.length === 1 ? "" : "s"} marked ${STATUS_LABEL[to].toLowerCase()}.`);
      setUndo({
        text: `${ids.length} cheque${ids.length === 1 ? "" : "s"} marked ${STATUS_LABEL[to].toLowerCase()}`,
        run: async () => {
          for (const r of before) await api.setStatus({ id: r.id, to: r.status, date: r.statusDate ?? undefined, reason: r.reason || undefined });
        },
      });
      setSelected(new Set());
      setMark(null);
      setDetails(null);
      await load();
      onChanged();
    } catch (e) {
      throw e;
    }
  }
  function printList() {
    try {
      const parts = [filter === "all" ? "All cheques" : CHIPS.find(([id]) => id === filter)?.[1] ?? "", accountId ? state.accounts.find((a) => a.id === accountId)?.name ?? "" : "", from || to ? `date ${from || "…"} to ${to || "…"}` : "", q ? `search "${q}"` : ""].filter(Boolean);
      printHtml(reportHtml(shown, { title: "Cheque list", filter: parts.join(" · "), today }));
    } catch (e) {
      setError(errorText(e));
    }
  }
  function exportCsv() {
    const url = URL.createObjectURL(new Blob([csv(shown)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Cheque-List-${today}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const dueBadge = (r: Cheque) => {
    const due = dueInfo(r, today, alerts);
    if (due.kind === "today") return <Badge tone="warn">Due today</Badge>;
    if (due.kind === "soon") return <Badge tone="warn">in {due.days} d</Badge>;
    if (due.kind === "overdue") return <Badge tone="danger">{Math.abs(due.days ?? 0)} d past</Badge>;
    if (due.kind === "later") return <span className="text-xs text-muted">in {due.days} d</span>;
    if (due.kind === "recent") return <span className="text-xs text-muted">{Math.abs(due.days ?? 0)} d past</span>;
    return null;
  };

  if (!rows) return <p className="text-muted">Loading the cheque list…</p>;
  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && !undo && <Alert tone="success">{notice}</Alert>}
      {undo && (
        <Alert tone="success">
          <span className="flex flex-wrap items-center gap-3">
            <span>{undo.text}.</span>
            <Button className="min-h-7 px-2 text-xs" variant="secondary" onClick={async () => { const u = undo; setUndo(null); setNotice(""); try { await u.run(); setNotice("Undone."); await load(); onChanged(); } catch (e) { setError(errorText(e)); } }}>Undo</Button>
            <Button className="min-h-7 px-2 text-xs" variant="ghost" onClick={() => setUndo(null)}>OK</Button>
          </span>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show cheques">
        {CHIPS.map(([id, label]) => (
          <Chip key={id} active={filter === id} onClick={() => { setFilter(id); setSelected(new Set()); }}>
            {label} <span className="opacity-75">{counts[id]}</span>
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Search" className="min-w-48 flex-1"><Input aria-label="Search cheques" placeholder="Payee, number, amount, note" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Bank account" className="w-44">
          <Select aria-label="Filter by bank" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Cheque date from" className="w-36"><Input aria-label="Date from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="to" className="w-36"><Input aria-label="Date to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="secondary" onClick={printList} disabled={!shown.length}>Print list</Button>
        <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}>Export to Excel (CSV)</Button>
      </div>
      {!!picked.length && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
          <span className="text-[13px] font-medium">{picked.length} selected</span>
          <Button className="min-h-7" variant="success" onClick={() => setMark({ ids: picked, to: "cleared" })}>Mark cleared</Button>
          <Button className="min-h-7" variant="danger" onClick={() => setMark({ ids: picked, to: "returned" })}>Mark returned</Button>
          <Button className="min-h-7" variant="secondary" onClick={() => setMark({ ids: picked, to: "cancelled" })}>Cancel cheques</Button>
          <Button className="min-h-7" variant="secondary" onClick={() => setMark({ ids: picked, to: "pending" })}>Back to pending</Button>
          <Button className="min-h-7" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-border bg-surface" style={{ maxHeight: "calc(100vh - 17rem)" }}>
        <table className="cw-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="w-8"><input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)))} /></th>
              <th>Cheque date</th><th>No.</th><th>Payee</th><th>Bank</th><th className="text-right">Amount</th><th>Status</th><th>Due</th><th>Note</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} data-status={r.status}>
                <td><input type="checkbox" aria-label={`Select cheque ${r.chequeNo}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="whitespace-nowrap">{r.chequeDate ?? <span className="text-subtle">no date</span>}</td>
                <td className="whitespace-nowrap font-medium">{r.chequeNo}</td>
                <td className="max-w-56 truncate" title={r.payee}>{r.payee}</td>
                <td className="max-w-36 truncate" title={r.accountName}>{r.accountName}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{money(r.amount, r.currency)}</td>
                <td>
                  <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {r.statusDate && <span className="ml-1 text-xs text-muted">{r.statusDate}</span>}
                  {r.status === "returned" && r.reason && <div className="text-xs text-danger">{r.reason}</div>}
                </td>
                <td>{dueBadge(r)}</td>
                <td className="max-w-40 truncate text-xs text-muted" title={r.note}>{r.note}</td>
                <td className="whitespace-nowrap text-right">
                  {r.status === "pending" ? (
                    <>
                      <Button className="min-h-7 px-2 text-xs" variant="success" onClick={() => setMark({ ids: [r.id], to: "cleared" })}>Cleared</Button>{" "}
                      <Button className="min-h-7 px-2 text-xs" variant="secondary" onClick={() => setMark({ ids: [r.id], to: "returned" })}>Returned</Button>{" "}
                    </>
                  ) : (
                    <Button className="min-h-7 px-2 text-xs" variant="secondary" onClick={() => setMark({ ids: [r.id], to: "pending" })}>Reopen</Button>
                  )}{" "}
                  <Button className="min-h-7 px-2 text-xs" variant="ghost" onClick={() => setDetails(r)}>Details</Button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={10} className="p-6 text-center text-muted">{rows.length ? "No cheques match this view." : "No cheques yet. Print a cheque with “Add cheque to list” ticked and it appears here."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {shown.length} cheque{shown.length === 1 ? "" : "s"} shown{pendingTotals.length ? ` · pending total ${pendingTotals.join(" + ")}` : ""}.
      </p>
      {mark && <MarkDialog key={mark.ids.join()} mark={mark} today={today} onClose={() => setMark(null)} onApply={apply} />}
      {details && <DetailsDialog cheque={details} onClose={() => setDetails(null)} onMark={(to) => { setMark({ ids: [details.id], to }); setDetails(null); }} onChanged={async () => { await load(); onChanged(); }} onRemoved={(c) => setUndo({ text: `Cheque ${c.chequeNo} removed from the list`, run: async () => { await api.restoreCheque(c); } })} onReprinted={(m) => setNotice(m)} />}
    </div>
  );
}

function MarkDialog({ mark, today, onClose, onApply }: { mark: { ids: string[]; to: Status }; today: string; onClose: () => void; onApply: (ids: string[], to: Status, date: string, reason: string) => Promise<void> }) {
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = STATUS_LABEL[mark.to];
  const n = mark.ids.length;
  return (
    <FormDialog
      title={mark.to === "pending" ? "Back to pending" : `Mark ${label.toLowerCase()}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            variant={mark.to === "returned" ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onApply(mark.ids, mark.to, date, reason);
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          >
            {mark.to === "pending" ? "Reopen" : `Mark ${label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p>{n} cheque{n === 1 ? "" : "s"} will be changed. The change is kept in the cheque history.</p>
        {mark.to !== "pending" && (
          <Field label={mark.to === "cleared" ? "Cleared on" : mark.to === "returned" ? "Returned on" : "Cancelled on"}>
            <Input aria-label="Status date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {(mark.to === "returned" || mark.to === "cancelled") && (
          <Field label={mark.to === "returned" ? "Reason returned (required)" : "Note (optional)"}>
            <Input aria-label="Reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mark.to === "returned" ? "For example: insufficient funds" : ""} />
          </Field>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </FormDialog>
  );
}

function DetailsDialog({ cheque, onClose, onMark, onChanged, onRemoved, onReprinted }: { cheque: Cheque; onClose: () => void; onMark: (to: Status) => void; onChanged: () => Promise<void>; onRemoved: (c: Cheque) => void; onReprinted: (message: string) => void }) {
  const { state } = useCw();
  const [note, setNote] = useState(cheque.note);
  const [date, setDate] = useState(cheque.chequeDate ?? "");
  const [blank, setBlank] = useState(!cheque.chequeDate);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.chequeHistory>>>([]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.chequeHistory(cheque.id).then(setHistory).catch((e) => setError(errorText(e)));
  }, [cheque.id]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={`Cheque ${cheque.chequeNo}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {cheque.status === "pending" && <Button variant="secondary" onClick={() => onMark("cancelled")}>Cancel this cheque</Button>}
          {cheque.status === "pending" && (
            <Button variant="secondary" disabled={busy} title="Prints this cheque again with the same number, for example after a paper jam" onClick={() => void run(async () => {
              const layoutId = cheque.layoutId || state.config.banks[cheque.accountId]?.layoutId || "";
              const layout = state.config.layouts[layoutId] as NativeLayout | undefined;
              const account = state.accounts.find((a) => a.id === cheque.accountId);
              if (!layout || !account) throw new Error("The bank layout of this cheque is not available. Print it again from Write & Print.");
              const cal = structuredClone(state.config.banks[cheque.accountId]?.calibration[layoutId] || defaultCalibration(layoutId));
              const values = { number: cheque.chequeNo, payee: cheque.payee, amount: cheque.amount, date: cheque.chequeDate ?? state.today, blankDate: !cheque.chequeDate, crossed: true, crossing: ((cheque as Cheque & { crossing?: number }).crossing as 1 | 2 | 3 | 4) || 1, noBearer: false, payeeCaps: false, style: "spelled_fils" as const, wording: cheque.wording || null };
              const result = await api.output({ action: "direct", request: engineRequest(layout, cal, values, { id: account.id, code: "", name: account.name, bankNo: account.bankNo }, cheque.currency), list: { accountId: cheque.accountId, layoutId } });
              onReprinted(result.cancelled ? "Reprint cancelled." : `Cheque ${cheque.chequeNo} printed again.`);
              await onChanged();
              onClose();
            })}>Reprint</Button>
          )}
          <Button variant="danger" disabled={busy} onClick={() => (confirmDelete ? void run(async () => { await api.deleteCheque(cheque.id); onRemoved(cheque); await onChanged(); onClose(); }) : setConfirmDelete(true))}>
            {confirmDelete ? "Yes, remove from list" : "Remove from list"}
          </Button>
          <Button disabled={busy} onClick={() => void run(async () => {
            if (note !== cheque.note) await api.setNote({ id: cheque.id, note });
            const next = blank ? null : date;
            if (next !== cheque.chequeDate) await api.setChequeDate({ id: cheque.id, date: next });
            await onChanged();
            onClose();
          })}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted">Payee</dt><dd>{cheque.payee}</dd>
          <dt className="text-muted">Bank</dt><dd>{cheque.accountName}</dd>
          <dt className="text-muted">Amount</dt><dd>{money(cheque.amount, cheque.currency)}</dd>
          <dt className="text-muted">Status</dt><dd>{STATUS_LABEL[cheque.status]}{cheque.statusDate ? ` on ${cheque.statusDate}` : ""}{cheque.reason ? ` — ${cheque.reason}` : ""}</dd>
          <dt className="text-muted">Issued on</dt><dd>{cheque.issuedOn}</dd>
        </dl>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Field label="Cheque date"><Input aria-label="Cheque date" type="date" disabled={blank} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="pb-2"><Tick label="No date" value={blank} onChange={setBlank} /></div>
        </div>
        <Field label="Note"><Input aria-label="Note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div>
          <h3 className="mb-1 text-xs font-semibold">History</h3>
          <ul className="max-h-40 space-y-1 overflow-auto text-xs text-muted">
            {history.map((h, i) => (
              <li key={i}><span className="tabular-nums">{h.at.slice(0, 16).replace("T", " ")}</span> · {h.action}{h.detail ? ` — ${h.detail}` : ""}</li>
            ))}
          </ul>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </FormDialog>
  );
}
