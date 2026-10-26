// PDF for the Template Printer: one JPEG picture placed at exact millimetre sizes, borders and guide lines
// as vector lines, "actual size" print preference. Ported from the SJMR Template Printer program.
import { gapLines, plan, positions, verticalLines, type TemplateSettings } from "./template-layout.ts";

const K = 72 / 25.4;
const N = (x: number) => {
  const text = x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" || text === "" ? "0" : text;
};
const ascii = (text: string) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

export function buildPdf(jpeg: Uint8Array, imageWidth: number, imageHeight: number, s: TemplateSettings): Uint8Array {
  const p = plan(s);
  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (b: Uint8Array) => {
    chunks.push(b);
    length += b.length;
  };
  const offsets: number[] = [0];
  const obj = (id: number, body: Uint8Array) => {
    offsets.push(length);
    write(ascii(`${id} 0 obj\n`));
    write(body);
    write(ascii("\nendobj\n"));
  };
  write(ascii("%PDF-1.4\n"));
  obj(1, ascii("<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>"));
  const kids = Array.from({ length: p.pages }, (_, i) => `${4 + 2 * i} 0 R`).join(" ");
  obj(2, ascii(`<< /Type /Pages /Count ${p.pages} /Kids [${kids}] >>`));
  const head = ascii(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  const image = new Uint8Array(head.length + jpeg.length + 10);
  image.set(head, 0);
  image.set(jpeg, head.length);
  image.set(ascii("\nendstream"), head.length + jpeg.length);
  obj(3, image);
  for (let i = 0; i < p.pages; i++) {
    const page = 4 + 2 * i,
      content = page + 1;
    obj(page, ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${N(s.pageW * K)} ${N(s.pageH * K)}] /Resources << /XObject << /Im0 3 0 R >> >> /Contents ${content} 0 R >>`));
    let sb = "";
    for (const r of positions(s, p, i)) {
      const y = N((s.pageH - r.y - s.height) * K);
      sb += `q\n${N(s.width * K)} 0 0 ${N(s.height * K)} ${N(r.x * K)} ${y} cm\n/Im0 Do\nQ\n`;
      if (s.border) sb += `q\n0 G\n${N(s.borderMm * K)} w\n${N(r.x * K)} ${y} ${N(s.width * K)} ${N(s.height * K)} re S\nQ\n`;
    }
    for (const y of gapLines(s, p, i)) sb += `q\n0 G\n0 w\n${N(s.margin * K)} ${N((s.pageH - y) * K)} m\n${N((s.pageW - s.margin) * K)} ${N((s.pageH - y) * K)} l S\nQ\n`;
    for (const line of verticalLines(s, p, i)) sb += `q\n0 G\n0 w\n${N(line.x * K)} ${N((s.pageH - line.top) * K)} m\n${N(line.x * K)} ${N((s.pageH - line.bottom) * K)} l S\nQ\n`;
    obj(content, ascii(`<< /Length ${sb.length} >>\nstream\n${sb}endstream`));
  }
  const xref = length;
  write(ascii(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`));
  for (const o of offsets.slice(1)) write(ascii(`${String(o).padStart(10, "0")} 00000 n \n`));
  write(ascii(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
