using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace SJMRChequeWriter
{
    public class PrintLineItem
    {
        public float x1_mm { get; set; }
        public float y1_mm { get; set; }
        public float x2_mm { get; set; }
        public float y2_mm { get; set; }
        public float width_pt { get; set; }
    }

    public class PrintTextItem
    {
        public float x_mm { get; set; }
        public float y_mm { get; set; }
        public string text { get; set; }
        public float font_pt { get; set; }
        public float rotation_deg { get; set; }
        public bool bold { get; set; }
    }

    public class PrintJobSpec
    {
        public string printer_name { get; set; }
        public string tray_name { get; set; }
        public string orientation { get; set; }
        public bool show_dialog { get; set; }
        public string document_name { get; set; }
        public List<PrintLineItem> lines { get; set; }
        public List<PrintTextItem> texts { get; set; }
    }

    public class ChequeDirectPrinter
    {
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int DocumentProperties(IntPtr hwnd, IntPtr hPrinter, string pDeviceName, IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);

        [DllImport("kernel32.dll", ExactSpelling = true)]
        public static extern IntPtr GlobalLock(IntPtr handle);

        [DllImport("kernel32.dll", ExactSpelling = true)]
        public static extern bool GlobalUnlock(IntPtr handle);

        [DllImport("kernel32.dll", ExactSpelling = true)]
        public static extern IntPtr GlobalFree(IntPtr handle);

        private const int DM_OUT_BUFFER = 2;
        private const int DM_IN_PROMPT = 4;
        private const int DM_IN_BUFFER = 8;

        public static PaperSource FindBestPaperSource(PrinterSettings ps, string requestedTray)
        {
            PaperSource mpFallback = null;
            foreach (PaperSource src in ps.PaperSources)
            {
                string sName = (src.SourceName ?? "").Trim();
                if (!string.IsNullOrEmpty(requestedTray) &&
                    sName.Equals(requestedTray.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    return src;
                }
                if (mpFallback == null &&
                    (sName.IndexOf("Multi", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     sName.IndexOf("MP", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     sName.IndexOf("Manual", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     src.RawKind == 4 || src.RawKind == 258))
                {
                    mpFallback = src;
                }
            }
            if (!string.IsNullOrEmpty(requestedTray))
            {
                foreach (PaperSource src in ps.PaperSources)
                {
                    string sName = (src.SourceName ?? "").Trim();
                    if (sName.IndexOf(requestedTray.Trim(), StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return src;
                    }
                }
            }
            return mpFallback;
        }

        /// <summary>
        /// Applies Landscape, Multi-purpose Tray, and Simplex (1-Sided) ONLY to the in-memory
        /// PrintDocument for the current print job. Does NOT call SetPrinter or alter Windows default settings.
        /// </summary>
        public static void ApplyJobOnlyDevMode(PrintDocument doc, bool landscape, int rawTrayKind)
        {
            try
            {
                PrinterSettings ps = doc.PrinterSettings;
                string printerName = ps.PrinterName;
                if (!ps.IsValid) return;

                IntPtr hDevMode = ps.GetHdevmode(doc.DefaultPageSettings);
                IntPtr pDevMode = GlobalLock(hDevMode);
                IntPtr hPrinter = IntPtr.Zero;
                if (OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
                {
                    int size = DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);
                    if (size > 0)
                    {
                        IntPtr pOut = Marshal.AllocHGlobal(size);
                        // Offset 76 = dmOrientation (2 = Landscape, 1 = Portrait)
                        Marshal.WriteInt16(pDevMode, 76, (short)(landscape ? 2 : 1));
                        // Offset 88 = dmDefaultSource (e.g. 4 = Multi-purpose Tray)
                        if (rawTrayKind > 0)
                        {
                            Marshal.WriteInt16(pDevMode, 88, (short)rawTrayKind);
                        }
                        // Offset 94 = dmDuplex (1 = Simplex / 1-Sided)
                        Marshal.WriteInt16(pDevMode, 94, (short)1);

                        int mode = DM_IN_BUFFER | DM_OUT_BUFFER;
                        int res = DocumentProperties(IntPtr.Zero, hPrinter, printerName, pOut, pDevMode, mode);
                        if (res >= 0)
                        {
                            // Apply ONLY to this PrintDocument instance in memory (temporary for this job only)
                            doc.PrinterSettings.SetHdevmode(pOut);
                            doc.DefaultPageSettings.SetHdevmode(pOut);
                        }
                        Marshal.FreeHGlobal(pOut);
                    }
                    ClosePrinter(hPrinter);
                }
                GlobalUnlock(hDevMode);
                GlobalFree(hDevMode);
            }
            catch
            {
            }
        }

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length == 0 || args[0] == "--list-printers")
            {
                var result = new List<Dictionary<string, object>>();
                foreach (string pName in PrinterSettings.InstalledPrinters)
                {
                    try
                    {
                        PrinterSettings ps = new PrinterSettings { PrinterName = pName };
                        var trays = new List<Dictionary<string, object>>();
                        foreach (PaperSource src in ps.PaperSources)
                        {
                            trays.Add(new Dictionary<string, object>
                            {
                                { "name", (src.SourceName ?? "").Trim() },
                                { "raw_kind", src.RawKind }
                            });
                        }
                        PaperSource bestMp = FindBestPaperSource(ps, null);
                        result.Add(new Dictionary<string, object>
                        {
                            { "name", pName },
                            { "is_default", ps.IsDefaultPrinter },
                            { "default_tray", bestMp != null ? (bestMp.SourceName ?? "").Trim() : (ps.DefaultPageSettings.PaperSource.SourceName ?? "").Trim() },
                            { "trays", trays }
                        });
                    }
                    catch
                    {
                    }
                }
                JavaScriptSerializer ser = new JavaScriptSerializer();
                Console.WriteLine(ser.Serialize(result));
                return 0;
            }

            if (args[0] == "--configure" && args.Length >= 2)
            {
                // No longer mutates system/user printer settings permanently.
                // If --prompt is passed, opens a temporary dialog purely to inspect driver trays/settings.
                string pName = args[1];
                string trayName = args.Length >= 3 ? args[2] : "Multi-purpose Tray";
                bool landscape = args.Length < 4 || !string.Equals(args[3], "Portrait", StringComparison.OrdinalIgnoreCase);
                bool prompt = args.Length >= 5 && args[4] == "--prompt";

                if (prompt)
                {
                    try
                    {
                        PrinterSettings ps = new PrinterSettings { PrinterName = pName };
                        if (ps.IsValid)
                        {
                            PaperSource src = FindBestPaperSource(ps, trayName);
                            int rawKind = src != null ? src.RawKind : 4;
                            IntPtr hDevMode = ps.GetHdevmode(ps.DefaultPageSettings);
                            IntPtr pDevMode = GlobalLock(hDevMode);
                            IntPtr hPrinter = IntPtr.Zero;
                            if (OpenPrinter(pName, out hPrinter, IntPtr.Zero))
                            {
                                int size = DocumentProperties(IntPtr.Zero, hPrinter, pName, IntPtr.Zero, IntPtr.Zero, 0);
                                if (size > 0)
                                {
                                    IntPtr pOut = Marshal.AllocHGlobal(size);
                                    Marshal.WriteInt16(pDevMode, 76, (short)(landscape ? 2 : 1));
                                    if (rawKind > 0) Marshal.WriteInt16(pDevMode, 88, (short)rawKind);
                                    Marshal.WriteInt16(pDevMode, 94, (short)1);
                                    // Opens dialog for preview/inspection ONLY — does NOT call SetPrinter
                                    DocumentProperties(IntPtr.Zero, hPrinter, pName, pOut, pDevMode, DM_IN_BUFFER | DM_OUT_BUFFER | DM_IN_PROMPT);
                                    Marshal.FreeHGlobal(pOut);
                                }
                                ClosePrinter(hPrinter);
                            }
                            GlobalUnlock(hDevMode);
                            GlobalFree(hDevMode);
                        }
                    }
                    catch
                    {
                    }
                }
                Console.WriteLine("OK");
                return 0;
            }

            if (args[0] == "--print" && args.Length >= 2)
            {
                string jsonPath = args[1];
                string jsonText = File.ReadAllText(jsonPath, Encoding.UTF8);
                JavaScriptSerializer ser = new JavaScriptSerializer();
                PrintJobSpec job = ser.Deserialize<PrintJobSpec>(jsonText);

                PrinterSettings ps = new PrinterSettings();
                if (!string.IsNullOrEmpty(job.printer_name))
                {
                    ps.PrinterName = job.printer_name;
                }
                if (!ps.IsValid)
                {
                    Console.Error.WriteLine("Invalid printer: " + job.printer_name);
                    return 2;
                }

                bool landscape = !string.Equals(job.orientation, "Portrait", StringComparison.OrdinalIgnoreCase);
                PaperSource chosenTray = FindBestPaperSource(ps, job.tray_name);
                int rawTray = chosenTray != null ? chosenTray.RawKind : 4;

                PrintDocument doc = new PrintDocument();
                doc.DocumentName = string.IsNullOrEmpty(job.document_name) ? "SJMR Cheque Leaf" : job.document_name;
                doc.PrinterSettings.PrinterName = ps.PrinterName;
                doc.PrinterSettings.Duplex = Duplex.Simplex;
                doc.OriginAtMargins = false;

                foreach (PaperSize sz in doc.PrinterSettings.PaperSizes)
                {
                    if (sz.Kind == PaperKind.A4 || string.Equals(sz.PaperName, "A4", StringComparison.OrdinalIgnoreCase))
                    {
                        doc.DefaultPageSettings.PaperSize = sz;
                        break;
                    }
                }
                doc.DefaultPageSettings.Landscape = landscape;
                doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                if (chosenTray != null)
                {
                    doc.DefaultPageSettings.PaperSource = chosenTray;
                }

                // Apply DEVMODE (Landscape + Multi-purpose Tray + Simplex) ONLY to this PrintDocument job in memory
                ApplyJobOnlyDevMode(doc, landscape, rawTray);

                // Re-ensure managed PageSettings properties match after SetHdevmode
                doc.DefaultPageSettings.Landscape = landscape;
                doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                if (chosenTray != null)
                {
                    doc.DefaultPageSettings.PaperSource = chosenTray;
                }

                doc.QueryPageSettings += (sender, qe) =>
                {
                    qe.PageSettings.Landscape = landscape;
                    if (chosenTray != null)
                    {
                        qe.PageSettings.PaperSource = chosenTray;
                    }
                };

                doc.PrintPage += (sender, pe) =>
                {
                    Graphics g = pe.Graphics;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                    g.PageUnit = GraphicsUnit.Millimeter;

                    // Compensate for hardware unprintable margin so (0, 0) mm is the true physical edge of the A4 sheet
                    float hardMarginX_mm = pe.PageSettings.HardMarginX * 25.4f / 100.0f;
                    float hardMarginY_mm = pe.PageSettings.HardMarginY * 25.4f / 100.0f;

                    if (job.lines != null)
                    {
                        foreach (var ln in job.lines)
                        {
                            float w_mm = Math.Max(0.25f, ln.width_pt * 25.4f / 72.0f);
                            using (Pen pen = new Pen(Color.Black, w_mm))
                            {
                                g.DrawLine(
                                    pen,
                                    ln.x1_mm - hardMarginX_mm,
                                    ln.y1_mm - hardMarginY_mm,
                                    ln.x2_mm - hardMarginX_mm,
                                    ln.y2_mm - hardMarginY_mm
                                );
                            }
                        }
                    }

                    if (job.texts != null)
                    {
                        StringFormat sf = new StringFormat(StringFormat.GenericTypographic);
                        sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;

                        foreach (var t in job.texts)
                        {
                            if (string.IsNullOrEmpty(t.text)) continue;
                            FontStyle style = t.bold ? FontStyle.Bold : FontStyle.Regular;
                            float pt = Math.Max(6.0f, t.font_pt);
                            using (Font font = new Font("Arial", pt, style, GraphicsUnit.Point))
                            {
                                float x = t.x_mm - hardMarginX_mm;
                                float y = t.y_mm - hardMarginY_mm;
                                if (Math.Abs(t.rotation_deg) < 0.05f)
                                {
                                    g.DrawString(t.text, font, Brushes.Black, x, y, sf);
                                }
                                else
                                {
                                    GraphicsState state = g.Save();
                                    // Rotate counter-clockwise by rotation_deg to match PDF and preview canvas
                                    g.TranslateTransform(x, y + (pt * 0.31f * 25.4f / 72.0f));
                                    g.RotateTransform(-t.rotation_deg);
                                    g.DrawString(t.text, font, Brushes.Black, 0f, -(pt * 0.35f * 25.4f / 72.0f), sf);
                                    g.Restore(state);
                                }
                            }
                        }
                    }

                    pe.HasMorePages = false;
                };

                if (job.show_dialog)
                {
                    using (PrintDialog dlg = new PrintDialog())
                    {
                        dlg.Document = doc;
                        dlg.UseEXDialog = true;
                        if (dlg.ShowDialog() != DialogResult.OK)
                        {
                            Console.WriteLine("CANCELLED");
                            return 0;
                        }
                    }
                }
                else
                {
                    doc.PrintController = new StandardPrintController();
                }

                doc.Print();
                Console.WriteLine("PRINTED_OK|" + doc.PrinterSettings.PrinterName + "|" + (chosenTray != null ? chosenTray.SourceName : "Auto") + "|" + (landscape ? "Landscape" : "Portrait"));
                return 0;
            }

            return 1;
        }
    }
}
