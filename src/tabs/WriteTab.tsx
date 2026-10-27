import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Alert, Button, Card, Field, FormDialog, Input, Select, Textarea } from "@/components/ui";
import { Group } from "@/components/groups";
import { SearchSelect } from "@/components/search-select";
import { Tick } from "@/components/bits";
import { api, errorText } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { drawChequePreview, photoToPng } from "@/lib/cheque-preview-draw";
import { getPref, setPref } from "@/lib/prefs";
import { suggestArabic } from "@/lib/arabic-names";
import {
  crossingStart,
  defaultCalibration,
  dragKeys,
  dragLabel,
  engineRequest,
  existingKeys,
  MOVE_PARTS,
  moveFields,
  resetCrossing,
  nextChequeNumber,
  type Calibration,
  type EnginePreview,
  type EnginePrinter,
  type NativeLayout,
  type WriterValues,
} from "@/lib/cheque-writer-model";

/** A short fingerprint of what the layout settings hold, without hashing the whole photo each time. */
function settingsSnap(layout: NativeLayout | null, cal: Calibration, layoutId: string) {
  const image = layout?.background_image;
  return JSON.stringify({
    layoutId,
    // An unset crossing start reads as the standard start.
    cal: { ...cal, crossingDefaults: crossingStart(cal) },
    layout: layout && {
      ...layout,
      background_image: image ? { format: image.format, n: image.data.length, a: image.data.slice(0, 48), z: image.data.slice(-48) } : undefined,
    },
  });
}

const LAST_ACCOUNT = "cw.lastAccount";
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice is then simply not remembered.
  }
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

export function WriteTab({ onListChanged }: { onListChanged: () => void }) {
  const { state, reload, setConfig, go } = useCw();
  const { config, accounts, payees, today } = state;
  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);
  const [accountId, setAccountId] = useState("");
  const [layoutId, setLayoutId] = useState("ADCB");
  const [layout, setLayout] = useState<NativeLayout | null>(null);
  const [cal, setCal] = useState<Calibration>(() => defaultCalibration());
  const [values, setValues] = useState<WriterValues>({
    number: "000001",
    payee: "",
    amount: "",
    date: today,
    blankDate: false,
    crossed: true,
    crossing: 4,
    noBearer: false,
    payeeCaps: true,
    style: getPref("cw.lang", "en") === "ar" ? "AR" : "spelled_fils",
    wording: null,
  });
  // The layout settings are locked every time the screen opens. Unlock to change them; one Save stores them all.
  const [locked, setLocked] = useState(true);
  const [base, setBase] = useState("");
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  const [addToList, setAddToList] = useState(true);
  const [followGuides, setFollowGuides] = useState(true);
  const [preview, setPreview] = useState<EnginePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printers, setPrinters] = useState<EnginePrinter[]>([]);
  const [printersNote, setPrintersNote] = useState("");
  const [advanced, setAdvanced] = useState(() => getPref("cw.advanced", "0") === "1");
  const [lang, setLang] = useState<"en" | "ar">(() => (getPref("cw.lang", "en") === "ar" ? "ar" : "en"));
  const [payeeAr, setPayeeAr] = useState("");
  const [hover, setHover] = useState<{ key: string; single: boolean } | null>(null);
  const [dragging, setDragging] = useState("");
  const running = useRef(false);
  const drag = useRef<{ x: number; y: number; w: number; h: number; cal: Calibration; key: string } | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency || "AED";
  const setValue = <K extends keyof WriterValues>(key: K, value: WriterValues[K]) => setValues((old) => ({ ...old, [key]: value }));
  const setCalibration = <K extends keyof Calibration>(key: K, value: Calibration[K]) => setCal((old) => ({ ...old, [key]: value }));

  function selectAccount(id: string) {
    const picked = accounts.find((a) => a.id === id);
    if (!picked) return;
    const saved = config.banks[id];
    const layoutKey = saved?.layoutId && config.layouts[saved.layoutId] ? saved.layoutId : config.layouts.ADCB ? "ADCB" : Object.keys(config.layouts)[0];
    const nextCal = structuredClone(saved?.calibration[layoutKey] || defaultCalibration(layoutKey));
    setAccountId(id);
    remember(LAST_ACCOUNT, id);
    setLayoutId(layoutKey);
    setLayout(structuredClone(config.layouts[layoutKey]));
    setCal(nextCal);
    setValues((old) => ({ ...old, ...crossingStart(nextCal) }));
    setLocked(true);
    setBase(settingsSnap(config.layouts[layoutKey], nextCal, layoutKey));
    api.nextChequeNo(id).then((next) => next && setValue("number", next)).catch(() => undefined);
  }
  function selectLayout(id: string) {
    if (!config.layouts[id]) return;
    const nextCal = structuredClone((accountId && config.banks[accountId]?.calibration[id]) || defaultCalibration(id));
    setLayoutId(id);
    setLayout(structuredClone(config.layouts[id]));
    setCal(nextCal);
    setValues((old) => ({ ...old, ...crossingStart(nextCal) }));
    setBase(settingsSnap(config.layouts[id], nextCal, id));
  }
  // The calibration as it would be saved now: the crossing choices on screen become the bank's start choices.
  const liveCal: Calibration = { ...cal, crossingDefaults: { crossed: values.crossed, crossing: values.crossing as 1 | 2 | 3 | 4, noBearer: values.noBearer } };
  const dirty = !locked && settingsSnap(layout, liveCal, layoutId) !== base;
  // A change of bank account or layout while there are unsaved settings asks first.
  function guard(action: () => void) {
    if (dirty) setPending({ run: action });
    else action();
  }
  function unlockLayout() {
    setBase(settingsSnap(layout, liveCal, layoutId));
    setLocked(false);
    setNotice("");
  }
  function lockLayout() {
    guard(() => {
      if (config.layouts[layoutId]) selectLayout(layoutId);
      else if (accountId) selectAccount(accountId);
      setLocked(true);
    });
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // First account: the one used last, else the first active one. Also when the accounts change.
  useEffect(() => {
    if (accountId && activeAccounts.some((a) => a.id === accountId)) return;
    const first = activeAccounts.find((a) => a.id === recall(LAST_ACCOUNT)) || activeAccounts[0];
    if (first) selectAccount(first.id);
    else {
      setAccountId("");
      setLayout(null);
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccounts]);
  const loadPrinters = () =>
    api
      .printers()
      .then((r) => {
        setPrinters(r.printers);
        setPrintersNote(r.printers.length ? "" : "No Windows printers were found (printing works on Windows only).");
      })
      .catch((e) => setPrintersNote(errorText(e)));
  useEffect(() => {
    void loadPrinters();
  }, []);
  useEffect(() => {
    if (cal.printer || !printers.length) return;
    const p = printers.find((x) => x.is_default) || printers[0];
    setCal((old) => (old.printer ? old : { ...old, printer: p.name, tray: p.default_tray || p.trays?.[0]?.name || old.tray }));
  }, [printers, cal.printer]);

  const printedPayee = lang === "ar" ? payeeAr : values.payee;
  const request = useMemo(
    () => (account && layout ? engineRequest(layout, cal, { ...values, payee: printedPayee }, { id: account.id, code: "", name: account.name, bankNo: account.bankNo }, currency) : null),
    [account, layout, cal, values, currency, printedPayee],
  );
  useEffect(() => {
    if (!request || !layout) return;
    let active = true;
    setPreviewBusy(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      api
        .preview({ ...request, followGuides })
        .then(async ({ scene, ...rest }) => ({ ...rest, png: await drawChequePreview(scene, layout.background_image) }))
        .then((result) => active && setPreview(result))
        .catch((e) => active && setPreviewError(errorText(e)))
        .finally(() => active && setPreviewBusy(false));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [request, followGuides, layout]);

  async function act(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function output(action: "direct" | "dialog" | "pdf") {
    if (!request || !account || previewBusy || previewError) return;
    await act(async () => {
      if (!printedPayee.trim() || !values.number.trim() || !(Number(values.amount.replaceAll(",", "")) > 0))
        throw new Error(lang === "ar" && !payeeAr.trim() ? "Type the payee name in Arabic (or press Suggest)." : "Enter a payee, cheque number and positive amount.");
      const result = await api.output({ action, request, list: addToList ? { accountId: account.id, layoutId, ...(lang === "ar" && values.payee.trim() ? { payee: values.payee.trim(), arabic: payeeAr.trim() } : {}) } : null });
      setNotice(result.message);
      if (result.listError) setError(`The cheque was printed but could not be added to the list: ${result.listError}`);
      if (result.saved) {
        onListChanged();
        void reload();
        try {
          setValue("number", nextChequeNumber(values.number));
        } catch {
          // A cheque number with letters is not counted up.
        }
        newCheque(true);
      }
    });
  }
  /** Clears the payee and amount for the next cheque and puts the cursor in the payee box (the number is already counted up). */
  function newCheque(keepNumber = false) {
    setValues((old) => ({ ...old, payee: "", amount: "", wording: null, number: keepNumber ? old.number : old.number }));
    setPayeeAr("");
    window.setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder^="Type a name"]')?.focus(), 50);
  }
  /** Prints a sample on plain paper with the cheque outline, so it can be held against a real cheque leaf. */
  async function testPrint() {
    if (!layout || !account || busy) return;
    await act(async () => {
      const sample = { ...values, payee: lang === "ar" ? "اسم المستفيد للتجربة" : "TEST PRINT - SAMPLE PAYEE", amount: "1234.56", wording: null, blankDate: false, date: today };
      const test = engineRequest(layout, cal, sample, { id: account.id, code: "", name: account.name, bankNo: account.bankNo }, currency, { outline: true });
      const result = await api.output({ action: "direct", request: test, list: null });
      setNotice(result.cancelled ? "Test print cancelled." : "Test sheet sent to the printer. Put plain paper in, then hold it against a real cheque leaf to check the places.");
    });
  }
  const outputRef = useRef<(a: "direct" | "dialog" | "pdf") => Promise<void>>(async () => undefined);
  outputRef.current = output;
  const newRef = useRef(newCheque);
  newRef.current = newCheque;
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const visible = document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.startsWith("Write");
      if (!visible || document.querySelector('[role="dialog"]')) return;
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        void outputRef.current("direct");
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        newRef.current(false);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  const chooseLang = useCallback((next: "en" | "ar") => {
    setLang(next);
    setPref("cw.lang", next);
    setValues((old) => ({ ...old, style: next === "ar" ? "AR" : "spelled_fils", wording: null }));
  }, []);
  // One save for everything of this bank account: layout, calibration, text, printer, tray, photo and crossing start.
  async function saveAll() {
    if (!account || !layout) return;
    await act(async () => {
      const next = await api.saveDesign({ kind: "all", revision: config.revision, bankId: account.id, isNew: false, layout, calibration: liveCal });
      const stored = next.layouts[layout.id] || layout;
      const savedCal = next.banks[account.id]?.calibration[layout.id] || liveCal;
      setConfig(next);
      setLayout(structuredClone(stored));
      setCal(structuredClone(savedCal));
      setBase(settingsSnap(stored, savedCal, layout.id));
      setLocked(true);
      setNotice(`All layout settings saved for ${account.name} (${stored.display_name || stored.id}): measurements, photo, offsets, text, printer, tray and crossing start are stored together. The layout is locked again.`);
    });
  }
  async function photo(file?: File) {
    if (!file || !layout) return;
    await act(async () => {
      if (file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PNG/JPEG under 10 MB.");
      const result = await api.image(await photoToPng(file));
      setLayout({ ...layout, background_image: result.background });
      setNotice("Alignment photo loaded. Press Save all layout settings to keep it. It is never printed.");
    });
  }
  function removePhoto() {
    if (!layout) return;
    const copy = { ...layout };
    delete copy.background_image;
    setLayout(copy);
    setNotice("Alignment photo removed. Press Save all layout settings to keep this.");
  }
  function pointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!preview || busy || previewBusy || locked) return;
    const box = e.currentTarget.getBoundingClientRect();
    const field = (e.target as SVGElement).getAttribute("data-field");
    // One field per drag: the one under the pointer. Empty space moves all the writing.
    const keys = field ? existingKeys(layout, dragKeys(field, e.shiftKey)) : null;
    drag.current = { x: e.clientX, y: e.clientY, w: box.width, h: box.height, cal: structuredClone(cal), key: keys ? keys.join(",") : "all" };
    setDragging(field ? dragLabel(field, e.shiftKey, !!preview.hitRegions.mmM1) : "all the writing");
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) {
      if (locked) return;
      const field = (e.target as SVGElement).getAttribute?.("data-field") || "";
      setHover((old) => (old?.key === field && old.single === e.shiftKey ? old : field ? { key: field, single: e.shiftKey } : null));
      return;
    }
    if (!preview) return;
    const dx = ((e.clientX - start.x) / start.w) * preview.widthMm,
      dy = ((e.clientY - start.y) / start.h) * preview.heightMm;
    setCal(
      start.key === "all"
        ? { ...start.cal, x: Math.round((start.cal.x + dx) * 1000) / 1000, y: Math.round((start.cal.y + dy) * 1000) / 1000 }
        : moveFields(start.cal, start.key.split(","), dx, dy),
    );
  }
  function pointerEnd() {
    drag.current = null;
    setDragging("");
  }

  const warnings = useMemo(() => {
    const out: string[] = [];
    const amount = Number(values.amount.replaceAll(",", ""));
    if (amount >= 1_000_000) out.push(`Large amount: ${currency} ${amount.toLocaleString("en-US")}. Check it before printing.`);
    if (!values.blankDate && values.date) {
      const days = Math.round((Date.parse(values.date) - Date.parse(today)) / 86400000);
      if (days > 183) out.push("The cheque date is more than 6 months ahead.");
      if (days < -183) out.push("The cheque date is more than 6 months ago. Banks may refuse an old (stale) cheque.");
    }
    const saved = cal.printer && printers.length && !printers.some((p) => p.name === cal.printer);
    if (saved) out.push(`The printer saved for this bank ("${cal.printer}") is not on this PC. Choose a printer before printing.`);
    return out;
  }, [values.amount, values.date, values.blankDate, today, currency, cal.printer, printers]);
  const nearPayee = useMemo(() => {
    const typed = values.payee.trim();
    if (lang === "ar" || typed.length < 4 || payees.some((p) => p.toLowerCase() === typed.toLowerCase())) return "";
    const low = typed.toLowerCase();
    let best = "";
    let bestScore = 3;
    for (const name of payees.slice(0, 5000)) {
      if (Math.abs(name.length - typed.length) > 2) continue;
      const d = editDistance(low, name.toLowerCase());
      if (d < bestScore) (bestScore = d), (best = name);
    }
    return best;
  }, [values.payee, payees, lang]);

  if (!activeAccounts.length)
    return (
      <Card className="mx-auto max-w-2xl space-y-3">
        <h2 className="text-base font-semibold">Welcome to SJMR Cheque Writer</h2>
        <p className="text-muted">Three steps and you can print your first cheque:</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li><strong>Add your bank account</strong> on the Banks &amp; Layouts tab (name and account number).</li>
          <li><strong>Choose the bank layout</strong> that matches your cheque book (the list has most UAE banks).</li>
          <li><strong>Print a test sheet</strong> on plain paper (button "Test print" on this screen), hold it against a cheque and move the writing with the mouse until it fits. It is remembered for this bank.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => go("banks")}>Start: add a bank account</Button>
          <Button variant="secondary" onClick={() => go("settings")}>I have the old Cheque Printer: import it</Button>
        </div>
      </Card>
    );

  const payeeItems = payees.map((name) => ({ id: name, name }));
  const trays = printers.find((p) => p.name === cal.printer)?.trays || [];
  const outputDisabled = !request || previewBusy || !!previewError || busy;
  const textInput = (key: "payee_prefix" | "payee_suffix" | "amount_prefix" | "amount_suffix" | "words_prefix" | "words_suffix", label: string) => (
    <Field label={label}>
      <Input aria-label={label} maxLength={80} value={cal.text[key]} onChange={(e) => setCalibration("text", { ...cal.text, [key]: e.target.value })} />
    </Field>
  );
  const layoutBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-sunken px-3 py-2" role="group" aria-label="Layout settings">
      <span className="mr-auto text-sm">
        <span className="font-semibold">{locked ? "Layout locked" : dirty ? "Layout unlocked · unsaved changes" : "Layout unlocked"}</span>
        <span className="block text-xs text-muted">
          {locked ? "Offsets, text, printer, photo and the writing position are protected." : "Change what you need, then press Save all layout settings."}
        </span>
      </span>
      {locked ? (
        <Button variant="secondary" disabled={!layout || busy} title="Allow changes to the layout settings" onClick={unlockLayout}>
          Unlock layout
        </Button>
      ) : (
        <>
          <Button disabled={!layout || !dirty || busy} onClick={() => void saveAll()}>
            Save all layout settings
          </Button>
          <Button variant="secondary" disabled={busy} onClick={lockLayout}>
            {dirty ? "Discard and lock" : "Lock layout"}
          </Button>
        </>
      )}
    </div>
  );
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <div className="grid items-start gap-3 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <Card className="space-y-2">
            <h2 className="text-sm font-semibold">Cheque details</h2>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Bank account">
                <SearchSelect items={activeAccounts} value={accountId} getLabel={(r) => r.name} getHint={(r) => r.bankNo} onChange={(id) => guard(() => selectAccount(id))} />
              </Field>
              <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
                <Field label={locked ? "Bank layout (locked)" : "Bank layout"}>
                  <SearchSelect items={Object.values(config.layouts)} value={layoutId} getLabel={(r) => r.display_name || r.id} getCode={(r) => r.id} onChange={(id) => guard(() => selectLayout(id))} />
                </Field>
              </fieldset>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Field label="Cheque number">
                <Input aria-label="Cheque number" value={values.number} onChange={(e) => setValue("number", e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                className="self-end"
                onClick={() => {
                  try {
                    setValue("number", nextChequeNumber(values.number));
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                +1
              </Button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <Field label="Cheque date">
                <Input aria-label="Cheque date" type="date" disabled={values.blankDate} value={values.date} onChange={(e) => setValue("date", e.target.value)} />
              </Field>
              <div className="pb-2"><Tick label="Blank date" value={values.blankDate} onChange={(v) => setValue("blankDate", v)} /></div>
            </div>
            <Field label={lang === "ar" ? "Payee name (English, for the payee list)" : "Payee"}>
              <SearchSelect
                items={payeeItems}
                value=""
                displayValue={values.payee}
                preserveTextUntilPick
                autoAdvance={false}
                placeholder="Type a name or pick from the payee list"
                getLabel={(r) => r.name}
                onQueryChange={(v) => setValue("payee", v)}
                onChange={(_id, row) => {
                  if (!row) return;
                  setValue("payee", row.name);
                  if (state.payeeAr[row.name]) setPayeeAr(state.payeeAr[row.name]);
                }}
              />
            </Field>
            {nearPayee && (
              <p className="text-xs text-warn">
                Did you mean <button type="button" className="font-semibold underline" onClick={() => { setValue("payee", nearPayee); if (state.payeeAr[nearPayee]) setPayeeAr(state.payeeAr[nearPayee]); }}>{nearPayee}</button>?
              </p>
            )}
            <Field label="Cheque language">
              <Select aria-label="Cheque language" value={lang} onChange={(e) => chooseLang(e.target.value as "en" | "ar")}>
                <option value="en">English</option>
                <option value="ar">Arabic (العربية): payee and amount in words</option>
              </Select>
            </Field>
            {lang === "ar" && (
              <Field label="Payee name in Arabic">
                <div className="flex gap-2">
                  <Input aria-label="Payee name in Arabic" dir="auto" lang="ar" maxLength={500} placeholder="اكتب اسم المستفيد" value={payeeAr} onChange={(e) => setPayeeAr(e.target.value)} />
                  <Button variant="secondary" disabled={!values.payee.trim()} title="Suggests an Arabic spelling of the English name. Check it before printing." onClick={() => setPayeeAr(state.payeeAr[values.payee.trim()] || suggestArabic(values.payee))}>Suggest</Button>
                </div>
                <span className="text-[11px] text-muted">You can type Arabic directly. "Suggest" gives a first spelling of the English name: always check it. Saved with the payee for next time.</span>
              </Field>
            )}
            {advanced && <Tick label="Payee in capital letters" value={values.payeeCaps} onChange={(v) => setValue("payeeCaps", v)} />}
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Amount (${currency})`}>
                <Input aria-label="Cheque amount" inputMode="decimal" value={values.amount} onChange={(e) => setValues((old) => ({ ...old, amount: e.target.value, wording: null }))} />
              </Field>
              {advanced && (
                <Field label="Wording style">
                  <Select aria-label="Wording style" value={values.style} onChange={(e) => setValues((old) => ({ ...old, style: e.target.value as WriterValues["style"], wording: null }))}>
                    <option value="spelled_fils">Spelled</option>
                    <option value="standard">75/100</option>
                    <option value="with_currency">Currency</option>
                    <option value="AR">Arabic</option>
                  </Select>
                </Field>
              )}
            </div>
            {advanced ? (
              <>
                <Field label="Amount in words">
                  <Textarea aria-label="Amount in words" dir="auto" rows={2} value={values.wording ?? preview?.words ?? ""} onChange={(e) => setValue("wording", e.target.value)} />
                </Field>
                <Button variant="ghost" className="min-h-7" onClick={() => setValue("wording", null)}>Automatic wording</Button>
              </>
            ) : (
              <p className="text-xs text-muted" dir="auto">{preview?.words}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Tick label="Crossed cheque" value={values.crossed} onChange={(v) => setValue("crossed", v)} />
              {advanced && <Tick label="Strike bearer" value={values.noBearer} onChange={(v) => setValue("noBearer", v)} />}
            </div>
            <p className="text-[11px] text-muted">
              {locked
                ? "Crossing choices count for this cheque only. To keep them as the start choices of this bank account: Unlock layout, set them, then Save all layout settings."
                : "Save all layout settings keeps these crossing choices as the start choices of this bank account."}
            </p>
            {values.crossed && (
              <Field label="Security crossing">
                <Select value={values.crossing} onChange={(e) => setValue("crossing", Number(e.target.value))}>
                  <option value={1}>A/C PAYEE ONLY</option>
                  <option value={2}>NOT NEGOTIABLE</option>
                  <option value={3}>A/C PAYEE ONLY — NOT NEGOTIABLE</option>
                  <option value={4}>CROSS ONLY (two lines, no text)</option>
                </Select>
              </Field>
            )}
          </Card>
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 lg:sticky lg:top-2 lg:z-10">
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Cheque preview</h2>
                  <span className="text-xs text-muted" aria-live="polite">
                    {previewBusy
                      ? "Updating…"
                      : locked
                        ? "Layout locked. Press Unlock layout to move the writing."
                        : dragging
                          ? `Moving: ${dragging}`
                          : hover
                            ? `Drag to move: ${dragLabel(hover.key, hover.single, !!preview?.hitRegions.mmM1)}${/^mm[DMY]\d$/.test(hover.key) && !hover.single ? " (hold Shift for one box)" : ""}`
                            : "Drag any writing to move just that field. Drag an empty place to move all the writing."}
                  </span>
                </div>
                {previewError && <Alert tone="danger">{previewError}</Alert>}
                {preview ? (
                  <div className="relative mx-auto w-full overflow-hidden rounded-md border border-border bg-sunken" style={{ aspectRatio: `${preview.widthMm}/${preview.heightMm}`, maxWidth: `max(18rem, calc((100vh - 21rem) * ${preview.widthMm / preview.heightMm}))` }}>
                    <img alt="Cheque PDF preview" dir="ltr" className="block h-full w-full" draggable={false} src={`data:image/png;base64,${preview.png}`} />
                    <svg
                      role="img"
                      aria-label="Drag cheque writing or individual fields"
                      className="absolute inset-0 h-full w-full"
                      viewBox={`0 0 ${preview.widthMm} ${preview.heightMm}`}
                      style={{ touchAction: "none", cursor: locked ? "default" : "move" }}
                      onPointerDown={pointerDown}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerEnd}
                      onPointerCancel={pointerEnd}
                      onPointerLeave={() => !drag.current && setHover(null)}
                    >
                      {(locked ? [] : Object.entries(preview.hitRegions)).map(([key, b]) => (
                        <rect key={key} className="cw-hit" data-field={key} x={b[0] - 1} y={b[1] - 1} width={Math.max(2, b[2] - b[0] + 2)} height={Math.max(2, b[3] - b[1] + 2)} fill="transparent" rx={0.8}>
                          <title>{`Move: ${dragLabel(key, false, !!preview.hitRegions.mmM1)}`}</title>
                        </rect>
                      ))}
                    </svg>
                  </div>
                ) : (
                  <p className="p-6 text-muted">Preparing the preview…</p>
                )}
                {!!preview?.outside.length && <Alert tone="warn">Writing extends beyond its available space: {preview.outside.join(", ")}. Adjust before printing.</Alert>}
                {layoutBar}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <Tick label="Add cheque to list" value={addToList} onChange={setAddToList} />
                <span className="flex-1" />
                <Button variant="secondary" disabled={!request || busy} title="Prints a sample with the cheque outline on plain paper" onClick={() => void testPrint()}>Test print</Button>
                {advanced && <Button variant="secondary" disabled={outputDisabled} onClick={() => void output("dialog")}>Windows Print dialog</Button>}
                {advanced && <Button variant="secondary" disabled={outputDisabled} onClick={() => void output("pdf")}>Cheque PDF</Button>}
                <Button disabled={outputDisabled} title="Ctrl+P" onClick={() => void output("direct")}>Print cheque</Button>
              </div>
              {warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
              <p className="text-xs text-muted">
                {addToList ? "After the cheque is printed it is added to the Cheque List as Pending, and the form is ready for the next cheque." : "Print only: this cheque is not added to the Cheque List."} Shortcuts: Ctrl+P print, Ctrl+N new cheque.
              </p>
              </Card>
            </div>
            <Card className="space-y-2">
              <fieldset disabled={locked} className="m-0 min-w-0 space-y-2 border-0 p-0">
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2" role="group" aria-label="Move with arrow buttons">
                <MoveRow label="All writing" aria="all" onMove={(dx, dy) => setCal((old) => ({ ...old, x: old.x + dx, y: old.y + dy }))} />
                {MOVE_PARTS.filter((p) => p.id !== "bearer" || values.noBearer).map((p) => (
                  <MoveRow key={p.id} label={p.label} aria={p.id} onMove={(dx, dy) => setCal((old) => moveFields(old, existingKeys(layout, p.keys), dx, dy))} onReset={p.id === "crossing" ? () => setCal((old) => resetCrossing(old)) : undefined} resetLabel="Reset crossing" />
                ))}
              </div>
              <p className="text-xs text-muted">Each arrow moves 0.5 mm. Hold Shift to move 0.1 mm.</p>
              </fieldset>
            </Card>
            <Card className="space-y-2">
              <fieldset disabled={locked} className="m-0 min-w-0 space-y-2 border-0 p-0">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Printer">
                  <Select
                    aria-label="Printer"
                    value={cal.printer}
                    onChange={(e) => {
                      const p = printers.find((x) => x.name === e.target.value);
                      setCal((old) => ({ ...old, printer: e.target.value, tray: p?.default_tray || p?.trays?.[0]?.name || old.tray }));
                    }}
                  >
                    <option value="">Windows default printer</option>
                    {printers.map((p) => <option key={p.name}>{p.name}</option>)}
                  </Select>
                </Field>
                {advanced && <Field label="Paper tray">
                  <Select aria-label="Paper tray" value={cal.tray} onChange={(e) => setCalibration("tray", e.target.value)}>
                    {!trays.some((t) => t.name === cal.tray) && <option>{cal.tray}</option>}
                    {trays.map((t) => <option key={t.name}>{t.name}</option>)}
                  </Select>
                </Field>}
                {advanced && <Field label="Orientation">
                  <Select value={cal.orientation} onChange={(e) => setCalibration("orientation", e.target.value as Calibration["orientation"])}>
                    <option>Landscape</option>
                    <option>Portrait</option>
                  </Select>
                </Field>}
                {advanced && <Field label="Feed mode">
                  <Select aria-label="Feed mode" value={cal.feed} onChange={(e) => setCalibration("feed", e.target.value as Calibration["feed"])}>
                    <option value="cheque_only">Cropped Cheque Leaf (PDF)</option>
                    <option value="a4_center_tray">Center Feed (MP Tray)</option>
                    <option value="a4_left_center_tray">Left-Center Feed Tray</option>
                    <option value="a4_edge_tray">Top/Edge Feed Tray</option>
                  </Select>
                </Field>}
              </div>
              {printersNote && <p className="text-xs text-muted">{printersNote} <button className="underline" onClick={() => void loadPrinters()}>Refresh printers</button></p>}
              </fieldset>
              <Tick label="Show advanced options (wording, tray, calibration, PDF)" value={advanced} onChange={(v) => { setAdvanced(v); setPref("cw.advanced", v ? "1" : "0"); }} />
            </Card>
          </div>
        </div>
        {advanced && (
          <div className="space-y-2">
            <Group id="cw-cal" title="Calibration" defaultOpen={false} locked={locked}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {([["width", "Width (mm)"], ["height", "Height (mm)"], ["font", "Font (pt)"], ["scale", "Scale (%)"], ["wrap", "Words line length"], ["x", "Offset X (mm)"], ["y", "Offset Y (mm)"], ["spacing", "Line spacing (mm)"], ["crossingShift", "Crossing shift (mm)"]] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input aria-label={label} type="number" step={key === "wrap" ? 1 : 0.1} value={Number.isFinite(cal[key]) ? cal[key] : ""} onChange={(e) => setCalibration(key, e.target.valueAsNumber)} />
                </Field>
              ))}
            </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setCal((old) => ({ ...defaultCalibration(layoutId), printer: old.printer, tray: old.tray, orientation: old.orientation, feed: old.feed, offsets: old.offsets, text: old.text }))}>Zero offsets / defaults</Button>
                <Tick label="Guides follow text offsets" value={followGuides} onChange={setFollowGuides} />
                <Tick label="Lock the crossing lines together (the two lines and the A/C Payee text move as one piece)" value={cal.crossingLock !== false} onChange={(v) => setCalibration("crossingLock", v)} />
              </div>
            </Group>
            <Group id="cw-text" title="Text before and after" defaultOpen={false} locked={locked}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold">Payee</h3>
                <div className="grid grid-cols-2 gap-2">{textInput("payee_prefix", "Payee prefix")}{textInput("payee_suffix", "Payee suffix")}</div>
                <Field label="Long payee">
                  <Select aria-label="Long payee" value={cal.text.long_payee} onChange={(e) => setCalibration("text", { ...cal.text, long_payee: e.target.value as Calibration["text"]["long_payee"] })}>
                    <option value="keep">Keep existing font size</option>
                    <option value="wrap">Wrap Payee in 2 Lines</option>
                    <option value="shrink">Reduce Payee Font Size</option>
                  </Select>
                </Field>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold">Amount</h3>
                <div className="grid grid-cols-2 gap-2">{textInput("amount_prefix", "Amount prefix")}{textInput("amount_suffix", "Amount suffix")}</div>
                <Tick label="No trailing zeros on whole amounts" value={cal.text.no_trailing_zeros} onChange={(v) => setCalibration("text", { ...cal.text, no_trailing_zeros: v })} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold">Amount wording</h3>
                <div className="grid grid-cols-2 gap-2">{textInput("words_prefix", "Wording prefix")}{textInput("words_suffix", "Wording suffix")}</div>
                <Tick label="Wording in capital letters" value={cal.text.words_caps} onChange={(v) => setCalibration("text", { ...cal.text, words_caps: v })} />
              </div>
            </div>
            </Group>
            <Group id="cw-photo" title="Alignment photo" defaultOpen={false} locked={locked}>
            <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="Blank cheque photo — alignment only (never printed)">
                <Input aria-label="Blank cheque photo" type="file" accept="image/png,image/jpeg" onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = ""; }} />
              </Field>
              <Button variant="secondary" disabled={!layout?.background_image} onClick={removePhoto}>Remove photo</Button>
            </div>
            </Group>
          </div>
        )}
      </fieldset>
      {pending && (
        <FormDialog
          title="Unsaved layout settings"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>Keep editing</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const next = pending;
                  setPending(null);
                  next.run();
                }}
              >
                Discard changes
              </Button>
            </>
          }
        >
          <p>You changed layout settings that are not saved. Discard these changes?</p>
        </FormDialog>
      )}
    </div>
  );
}

export type { EnginePrinter };

/** One row of four arrow buttons: moves a part of the cheque left, up, down or right (Shift = a finer step). */
function MoveRow({ label, aria, onMove, onReset, resetLabel }: { label: string; aria: string; onMove: (dx: number, dy: number) => void; onReset?: () => void; resetLabel?: string }) {
  const arrows = [["←", "left", -1, 0], ["↑", "up", 0, -1], ["↓", "down", 0, 1], ["→", "right", 1, 0]] as const;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="w-36 shrink-0 text-xs font-medium">{label}</span>
      {arrows.map(([mark, word, dx, dy]) => (
        <Button key={word} variant="secondary" className="min-h-7 px-2.5" aria-label={`Move ${aria} ${word}`} title={`${label}: ${word}`} onClick={(e) => { const step = e.shiftKey ? 0.1 : 0.5; onMove(dx * step, dy * step); }}>{mark}</Button>
      ))}
      {onReset && <Button variant="secondary" className="min-h-7 px-2.5" aria-label={resetLabel} title="Put it back where the layout has it" onClick={onReset}>Reset</Button>}
    </div>
  );
}

/** Number of single-letter changes between two names (used to offer "Did you mean ...?" for a payee). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
