// Template Printer: the printers with their paper sizes, and printing one prepared job.
// The layout, the picture and the PDF are made in the window (src/lib/template-*.ts); only the Windows printer
// itself goes through template-print.ps1.
const SCRIPT = "template-print.ps1";
const withoutBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function createTemplatePrinter({ runHelper, platform = "win32" } = {}) {
  let queue = Promise.resolve();
  const helper = (args, timeoutMs, extra = {}) =>
    Promise.resolve(runHelper({ script: SCRIPT, args, visible: false, timeoutMs, ...extra })).catch((error) => {
      throw new Error(/^(Print result|Cannot start|The cheque printing)/.test(error?.message ?? "") ? error.message : "Cannot start Windows printing: " + (error?.message ?? error));
    });

  async function printers() {
    if (platform !== "win32" || !runHelper) return { printers: [] };
    try {
      const result = await helper(["-Action", "list"], 45000);
      const list = JSON.parse(withoutBom(result.out) || "[]");
      return { printers: Array.isArray(list) ? list : [] };
    } catch {
      return { printers: [] };
    }
  }

  async function print(job) {
    if (platform !== "win32") throw new Error("Direct printing requires the main Windows program.");
    if (!job || typeof job !== "object" || !Array.isArray(job.pages) || !job.pages.length || typeof job.image_base64 !== "string")
      throw new Error("The print job is empty.");
    if (job.image_base64.length > 120 * 1024 * 1024) throw new Error("The picture is too large to print. Use a smaller scan.");
    const result = await helper(["-Action", "print"], job.show_dialog ? 300000 : 120000, { visible: !!job.show_dialog, job: JSON.stringify(job) });
    if (result.code === 0 && result.out.startsWith("PRINTED_OK")) {
      const parts = result.out.split("|");
      return { ok: true, cancelled: false, message: `Sent ${parts[2] || job.pages.length} page(s) to '${parts[1] || job.printer_name}'.` };
    }
    if (result.out === "CANCELLED") return { ok: false, cancelled: true, message: "Print cancelled." };
    throw new Error(result.err || result.out || `The printer exited with code ${result.code}`);
  }

  return {
    printers,
    // One print job at a time: the printer and its dialog are shared.
    print(job) {
      const next = queue.then(() => print(job));
      queue = next.catch(() => {});
      return next;
    },
  };
}
