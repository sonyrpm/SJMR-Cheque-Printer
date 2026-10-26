// Template Printer: print copies of a scanned picture (for example a cheque) at an exact size on any paper,
// for test printing without using a real cheque leaf. Ported from the SJMR Template Printer program.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { Tick } from "@/components/bits";
import { api, errorText, type TemplatePrinterInfo } from "@/lib/api";
import { DEFAULTS, gapLines, orient, plan as makePlan, positions, sizeFromDpi, summary, verticalLines, type TemplateSettings } from "@/lib/template-layout";
import { buildPdf } from "@/lib/template-pdf";

type Picture = { name: string; width: number; height: number; url: string; canvas: HTMLCanvasElement };
type Paper = { name: string; w: number; h: number; custom?: boolean };
const A4: Paper = { name: "A4", w: 210, h: 297 };
const CUSTOM: Paper = { name: "Custom", w: 210, h: 297, custom: true };
const ZOOMS = [
  ["fit", "Fit page"],
  ["50", "50%"],
  ["100", "100%"],
  ["150", "150%"],
  ["200", "200%"],
] as const;

/** A number box that lets the person type freely and only passes on valid numbers. */
function Num({ label, value, onChange, step = 0.1, min = 0, max = 5000, disabled }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) {
  // While the person types the box shows what they typed; otherwise it always shows the current value at once.
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const shown = editing || (text.trim() !== "" && Number(text) === value) ? text : String(value);
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        value={shown}
        onFocus={() => {
          setText(String(value));
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
      />
    </Field>
  );
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const blobBytes = async (canvas: HTMLCanvasElement, type: string, quality?: number) => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("The picture could not be prepared.");
  return new Uint8Array(await blob.arrayBuffer());
};

export function TemplateTab() {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [dpi, setDpi] = useState(300);
  const [s, setS] = useState<TemplateSettings>(DEFAULTS);
  const [paperName, setPaperName] = useState("A4");
  const [landscape, setLandscape] = useState(false);
  const [printers, setPrinters] = useState<TemplatePrinterInfo[]>([]);
  const [printer, setPrinter] = useState("");
  const [printersNote, setPrintersNote] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number][0]>("fit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const saved = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef("");

  const papers = useMemo<Paper[]>(() => {
    const list: Paper[] = [A4, CUSTOM];
    const chosen = printers.find((p) => p.name === printer);
    for (const p of chosen?.papers ?? []) if (!p.is_a4 && p.width_mm > 0 && p.height_mm > 0) list.push({ name: p.name, w: p.width_mm, h: p.height_mm });
    return list;
  }, [printers, printer]);
  const paper = papers.find((p) => p.name === paperName) ?? A4;
  const sheet = useMemo(() => (paper.custom ? { pageW: s.pageW, pageH: s.pageH } : orient(paper.w, paper.h, landscape)), [paper, landscape, s.pageW, s.pageH]);
  const full: TemplateSettings = useMemo(() => ({ ...s, ...sheet }), [s, sheet]);
  const layout = useMemo(() => {
    try {
      return { plan: makePlan(full), error: "" };
    } catch (e) {
      return { plan: null, error: errorText(e) };
    }
  }, [full]);
  const set = <K extends keyof TemplateSettings>(key: K, value: TemplateSettings[K]) => setS((old) => ({ ...old, [key]: value }));
  const pages = layout.plan?.pages ?? 1;
  const shownPage = Math.min(Math.max(page, 1), pages);

  const loadPrinters = useCallback(async () => {
    setPrintersNote("");
    try {
      const { printers: list } = await api.templatePrinters();
      setPrinters(list);
      setPrinter((old) => (list.some((p) => p.name === old) ? old : list.find((p) => p.is_default)?.name ?? list[0]?.name ?? ""));
      if (!list.length) setPrintersNote("No Windows printer was found. A4 and Custom paper still work for PDF.");
    } catch (e) {
      setPrintersNote(`Could not read the printers: ${errorText(e)}`);
    }
  }, []);

  // Remembered settings (never the picture), then the printers.
  useEffect(() => {
    void (async () => {
      try {
        const v = await api.templateSettings();
        setS((old) => ({ ...old, width: v.width, height: v.height, copies: v.copies, margin: v.margin, gap: v.gap, border: v.border, borderMm: v.borderMm, hLines: v.hLines, vLines: v.vLines, offsetX: v.offsetX, offsetY: v.offsetY, pageW: v.pageW, pageH: v.pageH }));
        setDpi(v.dpi);
        setLandscape(v.landscape);
        setPaperName(v.paper);
        setPrinter(v.printer);
      } catch {
        // First run: the defaults stand.
      }
      setLoaded(true);
      await loadPrinters();
    })();
  }, [loadPrinters]);
  // A remembered paper that this printer does not have falls back to A4.
  useEffect(() => {
    if (loaded && printers.length && !papers.some((p) => p.name === paperName)) setPaperName("A4");
  }, [loaded, printers, papers, paperName]);
  useEffect(() => {
    if (!loaded) return;
    if (saved.current) clearTimeout(saved.current);
    saved.current = setTimeout(() => {
      void api
        .saveTemplateSettings({ dpi, width: s.width, height: s.height, copies: s.copies, printer, paper: paperName, landscape, pageW: s.pageW, pageH: s.pageH, margin: s.margin, gap: s.gap, border: s.border, borderMm: s.borderMm, hLines: s.hLines, vLines: s.vLines, offsetX: s.offsetX, offsetY: s.offsetY })
        .catch(() => undefined);
    }, 700);
    return () => {
      if (saved.current) clearTimeout(saved.current);
    };
  }, [loaded, dpi, s, printer, paperName, landscape]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function loadPicture(file?: File | null) {
    if (!file) return;
    setError("");
    setNotice("");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Choose a picture under 100 MB.");
      if (/\.tiff?$/i.test(file.name) || file.type === "image/tiff") throw new Error("This window cannot open TIFF files. Save the scan as PNG or JPG and choose it again.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The picture could not be read.");
      context.fillStyle = "#fff"; // transparency is placed on white
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const url = URL.createObjectURL(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be read."))), "image/png")));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPicture({ name: file.name, width: canvas.width, height: canvas.height, url, canvas });
    } catch (e) {
      setError(e instanceof DOMException || (e instanceof Error && /decode|source image/i.test(e.message)) ? "Could not open the picture. Choose a PNG, JPG, BMP, GIF or WebP file." : errorText(e));
    }
  }
  function calculate() {
    if (!picture) return;
    setError("");
    try {
      const size = sizeFromDpi(picture.width, picture.height, dpi);
      setS((old) => ({ ...old, width: size.width, height: size.height }));
      setNotice(`Size set to ${size.width} x ${size.height} mm from ${picture.width} x ${picture.height} pixels at ${dpi} DPI. Compare it with a ruler measurement of the real cheque.`);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
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
  const savePdf = () =>
    run(async () => {
      if (!picture) return;
      const jpeg = await blobBytes(picture.canvas, "image/jpeg", 0.95);
      const bytes = buildPdf(jpeg, picture.width, picture.height, full);
      const result = await api.templateSavePdf({ base64: bytesToBase64(bytes), name: "Precision_Print.pdf" });
      setNotice(result.cancelled ? "PDF not saved." : `${result.message} Print it on the selected paper at Actual size / 100% and measure the first print.`);
    });
  const print = (dialog: boolean) =>
    run(async () => {
      if (!picture || !layout.plan) return;
      const p = layout.plan;
      let image = await blobBytes(picture.canvas, "image/png");
      if (image.length > 24 * 1024 * 1024) image = await blobBytes(picture.canvas, "image/jpeg", 0.95);
      const result = await api.templatePrint({
        printer_name: printer,
        document_name: "SJMR Template Print",
        show_dialog: dialog,
        page_w_mm: full.pageW,
        page_h_mm: full.pageH,
        image_base64: bytesToBase64(image),
        border_mm: full.border ? full.borderMm : 0,
        pages: Array.from({ length: p.pages }, (_, i) => ({
          rects: positions(full, p, i),
          lines: [
            ...gapLines(full, p, i).map((y) => ({ x1: full.margin, y1: y, x2: full.pageW - full.margin, y2: y })),
            ...verticalLines(full, p, i).map((l) => ({ x1: l.x, y1: l.top, x2: l.x, y2: l.bottom })),
          ],
        })),
      });
      setNotice(result.message + (result.cancelled ? "" : " Measure the first print with a ruler."));
    });

  const rects = layout.plan ? positions(full, layout.plan, shownPage - 1) : [];
  const hLines = layout.plan ? gapLines(full, layout.plan, shownPage - 1) : [];
  const vLines = layout.plan ? verticalLines(full, layout.plan, shownPage - 1) : [];
  const ready = !!picture && !!layout.plan && !busy;
  const previewWidth = zoom === "fit" ? undefined : `${(Number(zoom) / 100) * full.pageW * 3.78}px`;

  return (
    <div
      className="grid gap-3 lg:grid-cols-[340px_1fr]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void loadPicture(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Template Printer</h2>
          <p className="text-xs text-muted">Print copies of a cheque scan at its exact size on plain paper, for test printing. Choose the picture or drop it on this tab.</p>
          <Input aria-label="Choose picture" type="file" accept="image/png,image/jpeg,image/bmp,image/gif,image/webp,.png,.jpg,.jpeg,.bmp,.gif,.webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void loadPicture(file); }} />
          <p className="text-xs text-muted">{picture ? `${picture.name} · ${picture.width} x ${picture.height} pixels` : "No picture selected"}</p>
          <div className="grid grid-cols-2 items-end gap-2">
            <Num label="Scan resolution (DPI)" value={dpi} onChange={setDpi} step={1} min={1} max={100000} />
            <Button variant="secondary" disabled={!picture} onClick={calculate}>Calculate size from DPI</Button>
          </div>
          <p className="text-xs text-muted">Enter the DPI used when scanning, then press Calculate. The same DPI is used for width and height.</p>
        </Card>
        <Card className="space-y-2">
          <h3 className="text-xs font-semibold">Picture</h3>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Image width (mm)" value={s.width} onChange={(v) => set("width", v)} />
            <Num label="Image height (mm)" value={s.height} onChange={(v) => set("height", v)} />
          </div>
          <Button variant="secondary" onClick={() => setS((o) => ({ ...o, width: 201.9, height: 100.9, copies: 2, margin: 4, gap: 10 }))}>Preset: 201.9 x 100.9 mm</Button>
          <Num label="Total copies" value={s.copies} onChange={(v) => set("copies", Math.trunc(v))} step={1} min={1} max={1000} />
          <Tick label="Cutting border" value={s.border} onChange={(v) => set("border", v)} />
          <Num label="Border thickness (mm)" value={s.borderMm} onChange={(v) => set("borderMm", v)} step={0.01} min={0.01} max={2} />
          <Tick label="Horizontal centre lines" value={s.hLines} onChange={(v) => set("hLines", v)} />
          <Tick label="Vertical centre lines" value={s.vLines} onChange={(v) => set("vLines", v)} />
        </Card>
        <Card className="space-y-2">
          <h3 className="text-xs font-semibold">Printer and paper</h3>
          <Field label="Printer">
            <Select aria-label="Printer" value={printer} onChange={(e) => { setPrinter(e.target.value); setPaperName("A4"); }}>
              {!printers.length && <option value="">No printer found</option>}
              {printers.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" onClick={() => void loadPrinters()}>Refresh printers and paper sizes</Button>
          {printersNote && <p className="text-xs text-muted">{printersNote}</p>}
          <Field label="Paper size">
            <Select aria-label="Paper size" value={paper.name} onChange={(e) => setPaperName(e.target.value)}>
              {papers.map((p) => (
                <option key={p.name} value={p.name}>{p.custom ? p.name : `${p.name} (${+p.w.toFixed(2)} x ${+p.h.toFixed(2)} mm)`}</option>
              ))}
            </Select>
          </Field>
          <Field label="Orientation">
            <Select aria-label="Orientation" disabled={!!paper.custom} value={landscape ? "landscape" : "portrait"} onChange={(e) => setLandscape(e.target.value === "landscape")}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Paper width (mm)" value={paper.custom ? s.pageW : sheet.pageW} onChange={(v) => set("pageW", v)} disabled={!paper.custom} />
            <Num label="Paper height (mm)" value={paper.custom ? s.pageH : sheet.pageH} onChange={(v) => set("pageH", v)} disabled={!paper.custom} />
            <Num label="Minimum margin (mm)" value={s.margin} onChange={(v) => set("margin", v)} />
            <Num label="Gap between images (mm)" value={s.gap} onChange={(v) => set("gap", v)} />
          </div>
        </Card>
        <Card className="space-y-2">
          <h3 className="text-xs font-semibold">Micro-adjustment</h3>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Horizontal offset (mm)" value={s.offsetX} onChange={(v) => set("offsetX", v)} min={-1000} max={1000} step={0.1} />
            <Num label="Vertical offset (mm)" value={s.offsetY} onChange={(v) => set("offsetY", v)} min={-1000} max={1000} step={0.1} />
          </div>
          <p className="text-xs text-muted">+ moves right / down, - left / up. Step 0.1 mm; type values to 0.01 mm.</p>
          <Button variant="secondary" onClick={() => setS((o) => ({ ...o, offsetX: 0, offsetY: 0 }))}>Reset micro-adjustments</Button>
        </Card>
      </div>

      <div className="space-y-3">
        <Card className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Previous</Button>
            <span className="text-[13px]" aria-live="polite">Page {shownPage} / {pages}</span>
            <Button variant="secondary" disabled={shownPage >= pages} onClick={() => setPage(shownPage + 1)}>Next</Button>
            <Select aria-label="Zoom" className="w-28" value={zoom} onChange={(e) => setZoom(e.target.value as typeof zoom)}>
              {ZOOMS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>
            <span className="flex-1" />
            <Button disabled={!ready} onClick={() => void savePdf()}>Save PDF</Button>
            <Button disabled={!ready} onClick={() => void print(false)}>Print</Button>
            <Button variant="secondary" disabled={!ready} onClick={() => void print(true)}>Windows Print dialog</Button>
          </div>
          <pre className="whitespace-pre-wrap text-xs text-primary" role="status">{layout.plan ? summary(full, layout.plan) : layout.error}</pre>
        </Card>
        <div className="overflow-auto rounded-xl border border-border bg-sunken p-3" style={{ maxHeight: "calc(100vh - 14rem)" }}>
          {layout.plan ? (
            <svg
              role="img"
              aria-label="Page preview"
              viewBox={`0 0 ${full.pageW} ${full.pageH}`}
              className="mx-auto block bg-white shadow"
              style={zoom === "fit" ? { maxWidth: "100%", maxHeight: "calc(100vh - 19rem)", width: "auto", height: "auto", aspectRatio: `${full.pageW} / ${full.pageH}` } : { width: previewWidth }}
            >
              {rects.map((r, i) => (
                <g key={i}>
                  {picture ? <image href={picture.url} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" /> : <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#c8d4e6" />}
                  {!picture && <text x={r.x + 4} y={r.y + 8} fontSize={5} fill="#1f3a6b">Choose a picture</text>}
                  {full.border && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#000" strokeWidth={Math.max(full.borderMm, 0.15)} />}
                </g>
              ))}
              {hLines.map((y, i) => (
                <line key={`h${i}`} x1={full.margin} y1={y} x2={full.pageW - full.margin} y2={y} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
              {vLines.map((l, i) => (
                <line key={`v${i}`} x1={l.x} y1={l.top} x2={l.x} y2={l.bottom} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          ) : (
            <p className="p-4 text-[13px] text-danger">{layout.error}</p>
          )}
        </div>
        <p className="text-xs text-muted">
          Print at Actual size / 100%: in the printer properties turn off Fit, Shrink, borderless expansion and printer scaling. The picture is never shrunk; if it does not fit the printable area the job stops. Measure the first print with a ruler.
        </p>
      </div>
    </div>
  );
}
