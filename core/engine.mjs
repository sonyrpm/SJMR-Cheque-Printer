import {
  SOURCE,
  chequePdf,
  chequePreview,
  directJob,
  loadBackground,
  prepare,
  validateLayouts,
} from "../shared/cheque-core.mjs";

const actions = new Set(["printers", "preview", "pdf", "direct", "dialog", "image", "validate-layouts"]);
const withoutBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const FEEDS = ["cheque_only", "a4_center_tray", "a4_left_center_tray", "a4_edge_tray"];

const b64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// Cheque drawing and the PDF are plain JavaScript (cheque-core.mjs). Only the Windows printer
// itself (tray, orientation, print dialog) goes through cheque-direct.ps1, which compiles
// ChequeDirectPrinter.cs inside PowerShell. `runHelper` is the host's door to it:
// ({ args, job, visible, timeoutMs }) -> { code, out, err }. The host writes the job to a private
// temporary file, removes it afterwards and stops the helper when the time is up.
export function createChequeEngine({ runHelper, platform = "win32" } = {}) {
  let printQueue = Promise.resolve();

  function helper(args, timeoutMs, { visible = false, job } = {}) {
    return Promise.resolve(runHelper({ args, job, visible, timeoutMs })).catch((error) => {
      throw new Error(/^(Print result|Cannot start|The cheque printing)/.test(error?.message ?? "") ? error.message : "Cannot start Windows printing: " + (error?.message ?? error));
    });
  }

  async function printers() {
    if (platform !== "win32" || !runHelper) return { printers: [], source: SOURCE };
    try {
      const result = await helper(["-Action", "list"], 45000);
      const list = JSON.parse(withoutBom(result.out) || "[]");
      return { printers: Array.isArray(list) ? list : [], source: SOURCE };
    } catch {
      return { printers: [], source: SOURCE };
    }
  }

  async function print(request, dialog) {
    if (platform !== "win32") throw new Error("Direct printing requires the main Windows program.");
    const { template, data, account } = prepare({ ...request, action: dialog ? "dialog" : "direct" });
    const feed = request.feedMode ?? "cheque_only";
    if (!FEEDS.includes(feed)) throw new Error("Choose a feed mode.");
    const mode = feed === "cheque_only" ? "a4_center_tray" : feed;
    const orientation = account.CCAC_ORIENTATION || "Landscape";
    const job = directJob(template, data, account, mode, orientation);
    const spec = {
      printer_name: account.CCAC_PRINTER_NAME || "",
      tray_name: account.CCAC_PRINTER_TRAY || "Multi-purpose Tray",
      orientation,
      show_dialog: dialog,
      document_name: `Cheque #${data.CCT_CHEQUE_NO ?? ""} - ${data.CCT_PAYEE ?? ""}`,
      lines: job.lines,
      texts: job.texts,
    };
    const result = await helper(["-Action", "print"], dialog ? 180000 : 60000, { visible: dialog, job: JSON.stringify(spec) });
    if (result.code === 0 && result.out.startsWith("PRINTED_OK")) {
      const parts = result.out.split("|");
      return {
        ok: true,
        message: `Printed directly to '${parts[1] || spec.printer_name}'\nTray: ${parts[2] || spec.tray_name}  |  Orientation: ${parts[3] || spec.orientation}`,
        cancelled: false,
        source: SOURCE,
      };
    }
    if (result.out === "CANCELLED") return { ok: false, message: "CANCELLED", cancelled: true, source: SOURCE };
    return { ok: false, message: result.err || result.out || `Printer exited with code ${result.code}`, cancelled: false, source: SOURCE };
  }

  async function run(action, input = {}, caller = {}) {
    if (!actions.has(action)) throw new Error("Unknown cheque engine action.");
    if (["direct", "dialog"].includes(action) && platform !== "win32")
      throw new Error("Direct printing requires the main Windows program.");
    if (action === "dialog" && caller.mainWindow !== true)
      throw new Error("Open the print dialog from the main Windows program.");
    if (JSON.stringify(input).length > 24 * 1024 * 1024) throw new Error("Cheque request is too large.");
    if (action === "printers") return printers();
    if (action === "validate-layouts") return { layouts: validateLayouts(input.layouts) };
    if (action === "image") return loadBackground(input.data);
    if (action === "direct" || action === "dialog") return print(input, action === "dialog");
    const { template, data, account, overflow } = prepare({ ...input, action });
    if (action === "pdf")
      return { pdf: b64(chequePdf(template, data, account)), source: SOURCE };
    const view = chequePreview(template, data, account, input.followGuides ?? true);
    const outside = Object.entries(view.hitRegions)
      .filter(([, [l, t, r, b]]) => l < 0 || t < 0 || r > view.widthMm || b > view.heightMm)
      .map(([key]) => key);
    if (overflow) outside.push("Payee field width");
    return { ...view, words: data.CCT_WORDING, outside, source: SOURCE };
  }

  return {
    execute(action, input, caller) {
      // Unknown actions fail at once, like before (callers rely on the synchronous throw).
      if (!actions.has(action)) throw new Error("Unknown cheque engine action.");
      if (!["direct", "dialog"].includes(action)) return Promise.resolve().then(() => run(action, input, caller));
      const next = printQueue.then(() => run(action, input, caller));
      printQueue = next.catch(() => {});
      return next;
    },
  };
}
