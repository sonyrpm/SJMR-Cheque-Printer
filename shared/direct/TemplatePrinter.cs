using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace SJMRChequeWriter
{
    public class TemplateRect
    {
        public double x { get; set; }
        public double y { get; set; }
        public double w { get; set; }
        public double h { get; set; }
    }

    public class TemplateLine
    {
        public double x1 { get; set; }
        public double y1 { get; set; }
        public double x2 { get; set; }
        public double y2 { get; set; }
    }

    public class TemplatePage
    {
        public List<TemplateRect> rects { get; set; }
        public List<TemplateLine> lines { get; set; }
    }

    public class TemplateJob
    {
        public string printer_name { get; set; }
        public string document_name { get; set; }
        public bool show_dialog { get; set; }
        public double page_w_mm { get; set; }
        public double page_h_mm { get; set; }
        public string image_base64 { get; set; }
        public double border_mm { get; set; }
        public List<TemplatePage> pages { get; set; }
    }

    // Prints copies of one picture at exact millimetre sizes (SJMR Template Printer). Never scales the
    // picture: a paper size the printer does not take, or a picture outside the printable area, stops the job.
    public static class TemplatePrinter
    {
        const double Unit = 0.254; // millimetres in one hundredth of an inch

        static void ConfigurePaper(PrintDocument doc, double pageW, double pageH)
        {
            bool landscape = pageW > pageH;
            int w = (int)Math.Round(Math.Min(pageW, pageH) * 100 / 25.4);
            int h = (int)Math.Round(Math.Max(pageW, pageH) * 100 / 25.4);
            PaperSize selected = null;
            foreach (PaperSize size in doc.PrinterSettings.PaperSizes)
            {
                if (Math.Abs(size.Width - w) <= 1 && Math.Abs(size.Height - h) <= 1) { selected = size; break; }
            }
            doc.DefaultPageSettings.PaperSize = selected ?? new PaperSize("Exact size", w, h);
            doc.DefaultPageSettings.Landscape = landscape;
            // OriginAtMargins plus zero user margins makes the drawing origin the physical sheet corner;
            // PrintDocument compensates the printer's hard margins.
            doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            doc.OriginAtMargins = true;
        }

        static int ListPrinters()
        {
            var result = new List<Dictionary<string, object>>();
            foreach (string name in PrinterSettings.InstalledPrinters)
            {
                try
                {
                    PrinterSettings ps = new PrinterSettings { PrinterName = name };
                    var papers = new List<Dictionary<string, object>>();
                    foreach (PaperSize size in ps.PaperSizes)
                    {
                        if (size.Width <= 0 || size.Height <= 0) continue;
                        papers.Add(new Dictionary<string, object>
                        {
                            { "name", (size.PaperName ?? "").Trim() },
                            { "width_mm", Math.Round(size.Width * Unit, 2) },
                            { "height_mm", Math.Round(size.Height * Unit, 2) },
                            { "is_a4", size.Kind == PaperKind.A4 }
                        });
                    }
                    result.Add(new Dictionary<string, object>
                    {
                        { "name", name },
                        { "is_default", ps.IsDefaultPrinter },
                        { "papers", papers }
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

        static int Print(string jobFile)
        {
            JavaScriptSerializer ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            TemplateJob job = ser.Deserialize<TemplateJob>(File.ReadAllText(jobFile, Encoding.UTF8));
            if (job == null || job.pages == null || job.pages.Count == 0 || string.IsNullOrEmpty(job.image_base64))
                throw new Exception("The print job is empty.");
            using (MemoryStream stream = new MemoryStream(Convert.FromBase64String(job.image_base64)))
            using (Image image = Image.FromStream(stream))
            using (PrintDocument doc = new PrintDocument())
            {
                doc.DocumentName = string.IsNullOrEmpty(job.document_name) ? "SJMR Template Print" : job.document_name;
                if (!string.IsNullOrEmpty(job.printer_name)) doc.PrinterSettings.PrinterName = job.printer_name;
                if (!doc.PrinterSettings.IsValid)
                    throw new Exception("No printer is available. Install a Windows printer, or use Save PDF and open the PDF.");
                ConfigurePaper(doc, job.page_w_mm, job.page_h_mm);
                int current = 0;
                doc.BeginPrint += (s, e) => { current = 0; };
                doc.PrintPage += (s, e) =>
                {
                    double actualW = e.PageBounds.Width * Unit, actualH = e.PageBounds.Height * Unit;
                    if (Math.Abs(actualW - job.page_w_mm) > 0.6 || Math.Abs(actualH - job.page_h_mm) > 0.6)
                        throw new Exception("The printer did not accept the selected paper size. Select matching paper in Printer Properties, or choose another printer.");
                    TemplatePage page = job.pages[current];
                    RectangleF area = e.PageSettings.PrintableArea;
                    RectangleF printable = new RectangleF((float)(area.X * Unit), (float)(area.Y * Unit), (float)(area.Width * Unit), (float)(area.Height * Unit));
                    const float tolerance = 0.1f;
                    foreach (TemplateRect r in page.rects)
                    {
                        if (r.x < printable.Left - tolerance || r.y < printable.Top - tolerance || r.x + r.w > printable.Right + tolerance || r.y + r.h > printable.Bottom + tolerance)
                            throw new Exception("The image extends outside this printer's printable area. Nothing on this page was drawn. Use larger paper, another orientation or a printer with smaller margins. The app will not shrink the picture.");
                    }
                    // Keep PrintDocument's hundredths-of-an-inch coordinate system so its hard-margin transform stays in the same units.
                    e.Graphics.PageUnit = GraphicsUnit.Display;
                    e.Graphics.PageScale = 1;
                    e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    foreach (TemplateRect r in page.rects)
                    {
                        RectangleF target = new RectangleF((float)(r.x / Unit), (float)(r.y / Unit), (float)(r.w / Unit), (float)(r.h / Unit));
                        e.Graphics.DrawImage(image, target);
                        if (job.border_mm > 0)
                            using (Pen pen = new Pen(Color.Black, (float)(job.border_mm / Unit)))
                                e.Graphics.DrawRectangle(pen, target.X, target.Y, target.Width, target.Height);
                    }
                    using (Pen hair = new Pen(Color.Black, 0))
                        foreach (TemplateLine l in page.lines)
                            e.Graphics.DrawLine(hair, (float)(l.x1 / Unit), (float)(l.y1 / Unit), (float)(l.x2 / Unit), (float)(l.y2 / Unit));
                    current++;
                    e.HasMorePages = current < job.pages.Count;
                };
                if (job.show_dialog)
                {
                    using (PrintDialog dialog = new PrintDialog())
                    {
                        dialog.Document = doc;
                        dialog.UseEXDialog = true;
                        dialog.AllowSomePages = false;
                        dialog.AllowSelection = false;
                        dialog.AllowPrintToFile = false;
                        if (dialog.ShowDialog() != DialogResult.OK)
                        {
                            Console.WriteLine("CANCELLED");
                            return 0;
                        }
                    }
                    // The driver's defaults must not replace the exact layout chosen in the app.
                    ConfigurePaper(doc, job.page_w_mm, job.page_h_mm);
                }
                else
                {
                    doc.PrintController = new StandardPrintController();
                }
                doc.Print();
                Console.WriteLine("PRINTED_OK|" + doc.PrinterSettings.PrinterName + "|" + job.pages.Count);
                return 0;
            }
        }

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            try
            {
                if (args.Length >= 1 && args[0] == "--list-printers") return ListPrinters();
                if (args.Length >= 2 && args[0] == "--print") return Print(args[1]);
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 3;
            }
        }
    }
}
