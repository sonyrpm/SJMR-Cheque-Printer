import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { Tick } from "@/components/bits";
import { api, errorText } from "@/lib/api";
import { useCw } from "@/lib/cw-context";
import { drawChequePreview, photoToPng } from "@/lib/cheque-preview-draw";
import {
  defaultCalibration,
  engineRequest,
  moveFields,
  nextChequeNumber,
  type Calibration,
  type EnginePreview,
  type EnginePrinter,
  type NativeLayout,
  type WriterValues,
} from "@/lib/cheque-writer-model";

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
    crossing: 1,
    noBearer: false,
    payeeCaps: true,
    style: "spelled_fils",
    wording: null,
  });
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
    setAccountId(id);
    remember(LAST_ACCOUNT, id);
    setLayoutId(layoutKey);
    setLayout(structuredClone(config.layouts[layoutKey]));
    setCal(structuredClone(saved?.calibration[layoutKey] || defaultCalibration(layoutKey)));
    api.nextChequeNo(id).then((next) => next && setValue("number", next)).catch(() => undefined);
  }
  function selectLayout(id: string) {
    if (!config.layouts[id]) return;
    setLayoutId(id);
    setLayout(structuredClone(config.layouts[id]));
    setCal(structuredClone((accountId && config.banks[accountId]?.calibration[id]) || defaultCalibration(id)));
  }
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

  const request = useMemo(
    () => (account && layout ? engineRequest(layout, cal, values, { id: account.id, code: "", name: account.name, bankNo: account.bankNo }, currency) : null),
    [account, layout, cal, values, currency],
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
      if (!values.payee.trim() || !values.number.trim() || !(Number(values.amount.replaceAll(",", "")) > 0))
        throw new Error("Enter a payee, cheque number and positive amount.");
      const result = await api.output({ action, request, list: addToList ? { accountId: account.id, layoutId } : null });
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
      }
    });
  }
  async function saveCalibration() {
    if (!account) return;
    await act(async () => {
      setConfig(await api.saveDesign({ kind: "calibration", revision: config.revision, bankId: account.id, layoutId, calibration: cal }));
      setNotice("Calibration saved for this bank account and layout.");
    });
  }
  async function persistLayout(next: NativeLayout) {
    setConfig(await api.saveDesign({ kind: "layouts", revision: config.revision, layouts: { [next.id]: next }, replace: true }));
    setLayout(next);
  }
  async function photo(file?: File) {
    if (!file || !layout) return;
    await act(async () => {
      if (file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PNG/JPEG under 10 MB.");
      const result = await api.image(await photoToPng(file));
      await persistLayout({ ...layout, background_image: result.background });
      setNotice("Alignment photo saved with this layout. It is never printed.");
    });
  }
  async function removePhoto() {
    if (!layout) return;
    await act(async () => {
      const copy = { ...layout };
      delete copy.background_image;
      await persistLayout(copy);
      setNotice("Alignment photo removed.");
    });
  }
  function pointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!preview || busy || previewBusy) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, w: box.width, h: box.height, cal: structuredClone(cal), key: (e.target as SVGElement).getAttribute("data-field") || "all" };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start || !preview) return;
    const dx = ((e.clientX - start.x) / start.w) * preview.widthMm,
      dy = ((e.clientY - start.y) / start.h) * preview.heightMm;
    setCal(
      start.key === "all"
        ? { ...start.cal, x: Math.round((start.cal.x + dx) * 1000) / 1000, y: Math.round((start.cal.y + dy) * 1000) / 1000 }
        : moveFields(start.cal, [start.key], dx, dy),
    );
  }

  if (!activeAccounts.length)
    return (
      <Alert tone="warn">
        Add a bank account first.{" "}
        <Button variant="secondary" onClick={() => go("banks")}>Go to Banks &amp; Layouts</Button>
      </Alert>
    );

  const payeeItems = payees.map((name) => ({ id: name, name }));
  const trays = printers.find((p) => p.name === cal.printer)?.trays || [];
  const outputDisabled = !request || previewBusy || !!previewError || busy;
  const textInput = (key: "payee_prefix" | "payee_suffix" | "amount_prefix" | "amount_suffix" | "words_prefix" | "words_suffix", label: string) => (
    <Field label={label}>
      <Input aria-label={label} maxLength={80} value={cal.text[key]} onChange={(e) => setCalibration("text", { ...cal.text, [key]: e.target.value })} />
    </Field>
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
                <SearchSelect items={activeAccounts} value={accountId} getLabel={(r) => r.name} getHint={(r) => r.bankNo} onChange={(id) => selectAccount(id)} />
              </Field>
              <Field label="Bank layout">
                <SearchSelect items={Object.values(config.layouts)} value={layoutId} getLabel={(r) => r.display_name || r.id} getCode={(r) => r.id} onChange={(id) => selectLayout(id)} />
              </Field>
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
            <Field label="Payee">
              <SearchSelect
                items={payeeItems}
                value=""
                displayValue={values.payee}
                preserveTextUntilPick
                autoAdvance={false}
                placeholder="Type a name or pick from the payee list"
                getLabel={(r) => r.name}
                onQueryChange={(v) => setValue("payee", v)}
                onChange={(_id, row) => row && setValue("payee", row.name)}
              />
            </Field>
            <Tick label="Payee in capital letters" value={values.payeeCaps} onChange={(v) => setValue("payeeCaps", v)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Amount (${currency})`}>
                <Input aria-label="Cheque amount" inputMode="decimal" value={values.amount} onChange={(e) => setValues((old) => ({ ...old, amount: e.target.value, wording: null }))} />
              </Field>
              <Field label="Wording style">
                <Select aria-label="Wording style" value={values.style} onChange={(e) => setValues((old) => ({ ...old, style: e.target.value as WriterValues["style"], wording: null }))}>
                  <option value="spelled_fils">Spelled</option>
                  <option value="standard">75/100</option>
                  <option value="with_currency">Currency</option>
                  <option value="AR">Arabic</option>
                </Select>
              </Field>
            </div>
            <Field label="Amount in words">
              <Textarea aria-label="Amount in words" rows={2} value={values.wording ?? preview?.words ?? ""} onChange={(e) => setValue("wording", e.target.value)} />
            </Field>
            <Button variant="ghost" className="min-h-7" onClick={() => setValue("wording", null)}>Automatic wording</Button>
            <div className="grid grid-cols-2 gap-2">
              <Tick label="Crossed cheque" value={values.crossed} onChange={(v) => setValue("crossed", v)} />
              <Tick label="Strike bearer" value={values.noBearer} onChange={(v) => setValue("noBearer", v)} />
            </div>
            <Field label="Security crossing">
              <Select value={values.crossing} onChange={(e) => setValue("crossing", Number(e.target.value))}>
                <option value={1}>A/C PAYEE ONLY</option>
                <option value={2}>NOT NEGOTIABLE</option>
                <option value={3}>A/C PAYEE ONLY — NOT NEGOTIABLE</option>
              </Select>
            </Field>
          </Card>
          <div className="min-w-0 space-y-3">
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Cheque preview</h2>
                <span className="text-xs text-muted">{previewBusy ? "Updating…" : "Drag a field to move it, or drag the cheque to move all writing"}</span>
              </div>
              {previewError && <Alert tone="danger">{previewError}</Alert>}
              {preview ? (
                <div className="relative w-full overflow-hidden rounded-md border border-border bg-sunken" style={{ aspectRatio: `${preview.widthMm}/${preview.heightMm}` }}>
                  <img alt="Cheque PDF preview" className="block h-full w-full" draggable={false} src={`data:image/png;base64,${preview.png}`} />
                  <svg
                    role="img"
                    aria-label="Drag cheque writing or individual fields"
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${preview.widthMm} ${preview.heightMm}`}
                    style={{ touchAction: "none", cursor: "move" }}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                  >
                    {Object.entries(preview.hitRegions).map(([key, b]) => (
                      <rect key={key} data-field={key} x={b[0] - 1} y={b[1] - 1} width={Math.max(2, b[2] - b[0] + 2)} height={Math.max(2, b[3] - b[1] + 2)} fill="transparent">
                        <title>Move {key}</title>
                      </rect>
                    ))}
                  </svg>
                </div>
              ) : (
                <p className="p-6 text-muted">Preparing the preview…</p>
              )}
              {!!preview?.outside.length && <Alert tone="warn">Writing extends beyond its available space: {preview.outside.join(", ")}. Adjust before printing.</Alert>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1">
                  <span className="text-xs font-medium">Move all</span>
                  {([["←", -0.5, 0], ["↑", 0, -0.5], ["↓", 0, 0.5], ["→", 0.5, 0]] as const).map(([label, dx, dy]) => (
                    <Button key={label} variant="secondary" className="min-h-7 px-2" aria-label={`Move all ${label}`} onClick={() => setCal((old) => ({ ...old, x: old.x + dx, y: old.y + dy }))}>{label}</Button>
                  ))}
                </span>
                {([["payee", ["mmPayee"]], ["words", ["mmAmountText1", "mmAmountText2"]]] as [string, string[]][]).map(([label, keys]) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className="text-xs font-medium">Move {label}</span>
                    <Button variant="secondary" className="min-h-7 px-2" aria-label={`Move ${label} left`} onClick={() => setCal((old) => moveFields(old, keys, -0.5))}>←</Button>
                    <Button variant="secondary" className="min-h-7 px-2" aria-label={`Move ${label} right`} onClick={() => setCal((old) => moveFields(old, keys, 0.5))}>→</Button>
                  </span>
                ))}
              </div>
            </Card>
            <Card className="space-y-2">
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
                <Field label="Paper tray">
                  <Select aria-label="Paper tray" value={cal.tray} onChange={(e) => setCalibration("tray", e.target.value)}>
                    {!trays.some((t) => t.name === cal.tray) && <option>{cal.tray}</option>}
                    {trays.map((t) => <option key={t.name}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="Orientation">
                  <Select value={cal.orientation} onChange={(e) => setCalibration("orientation", e.target.value as Calibration["orientation"])}>
                    <option>Landscape</option>
                    <option>Portrait</option>
                  </Select>
                </Field>
                <Field label="Feed mode">
                  <Select aria-label="Feed mode" value={cal.feed} onChange={(e) => setCalibration("feed", e.target.value as Calibration["feed"])}>
                    <option value="cheque_only">Cropped Cheque Leaf (PDF)</option>
                    <option value="a4_center_tray">Center Feed (MP Tray)</option>
                    <option value="a4_left_center_tray">Left-Center Feed Tray</option>
                    <option value="a4_edge_tray">Top/Edge Feed Tray</option>
                  </Select>
                </Field>
              </div>
              {printersNote && <p className="text-xs text-muted">{printersNote} <button className="underline" onClick={() => void loadPrinters()}>Refresh printers</button></p>}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <Tick label="Add cheque to list" value={addToList} onChange={setAddToList} />
                <span className="flex-1" />
                <Button disabled={outputDisabled} onClick={() => void output("direct")}>Print directly</Button>
                <Button variant="secondary" disabled={outputDisabled} onClick={() => void output("dialog")}>Windows Print dialog</Button>
                <Button variant="secondary" disabled={outputDisabled} onClick={() => void output("pdf")}>Cheque PDF</Button>
              </div>
              <p className="text-xs text-muted">
                {addToList ? "After the cheque is printed it is added to the Cheque List as Pending." : "Print only: this cheque is not added to the Cheque List."}
              </p>
            </Card>
          </div>
        </div>
        <details className="rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Calibration and text options</summary>
          <div className="space-y-3 border-t border-border p-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {([["width", "Width (mm)"], ["height", "Height (mm)"], ["font", "Font (pt)"], ["scale", "Scale (%)"], ["wrap", "Words line length"], ["x", "Offset X (mm)"], ["y", "Offset Y (mm)"], ["spacing", "Line spacing (mm)"], ["crossingShift", "Crossing shift (mm)"]] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input aria-label={label} type="number" step={key === "wrap" ? 1 : 0.1} value={Number.isFinite(cal[key]) ? cal[key] : ""} onChange={(e) => setCalibration(key, e.target.valueAsNumber)} />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void saveCalibration()}>Save calibration</Button>
              <Button variant="secondary" onClick={() => setCal((old) => ({ ...defaultCalibration(layoutId), printer: old.printer, tray: old.tray, orientation: old.orientation, feed: old.feed, offsets: old.offsets, text: old.text }))}>Zero offsets / defaults</Button>
              <Tick label="Guides follow text offsets" value={followGuides} onChange={setFollowGuides} />
            </div>
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
            <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="Blank cheque photo — alignment only (never printed)">
                <Input aria-label="Blank cheque photo" type="file" accept="image/png,image/jpeg" onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = ""; }} />
              </Field>
              <Button variant="secondary" disabled={!layout?.background_image} onClick={() => void removePhoto()}>Remove photo</Button>
            </div>
          </div>
        </details>
      </fieldset>
    </div>
  );
}

export type { EnginePrinter };
