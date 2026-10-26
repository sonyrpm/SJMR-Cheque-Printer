// Draws the cheque preview in the browser from the numbers the books server sends.
// The printed text is exactly what goes to the printer; the paper guide is only decoration.
const MM_TO_PT = 72 / 25.4;
const WIDTH_PX = 1600;

export type SceneItem =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; w: number; c: number[] }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill: number[] | null; stroke: number[] | null; lw: number }
  | { k: "text"; x: number; y: number; text: string; font: string; size: number; rot: number; c: number[]; rtl?: boolean; bw?: number };
export type PreviewScene = {
  widthMm: number;
  heightMm: number;
  printed: SceneItem[];
  guide: SceneItem[] | null;
};

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

function paint(ctx: CanvasRenderingContext2D, items: SceneItem[], scale: number) {
  for (const item of items) {
    if (item.k === "line") {
      ctx.strokeStyle = rgb(item.c);
      ctx.lineWidth = Math.max(1, ((item.w * 25.4) / 72) * scale);
      ctx.beginPath();
      ctx.moveTo(item.x1 * scale, item.y1 * scale);
      ctx.lineTo(item.x2 * scale, item.y2 * scale);
      ctx.stroke();
    } else if (item.k === "rect") {
      if (item.fill) {
        ctx.fillStyle = rgb(item.fill);
        ctx.fillRect(item.x * scale, item.y * scale, item.w * scale, item.h * scale);
      }
      if (item.stroke) {
        ctx.strokeStyle = rgb(item.stroke);
        ctx.lineWidth = Math.max(1, ((item.lw * 25.4) / 72) * scale);
        ctx.strokeRect(item.x * scale, item.y * scale, item.w * scale, item.h * scale);
      }
    } else {
      const px = (item.size / MM_TO_PT) * scale;
      const face = item.font === "F3" ? "'Courier New', monospace" : item.rtl ? "CWNaskh, Helvetica, Arial, sans-serif" : "Helvetica, Arial, sans-serif";
      ctx.font = `${item.font === "F1" ? "" : "bold "}${px}px ${face}`;
      ctx.fillStyle = rgb(item.c);
      ctx.textBaseline = "alphabetic";
      const x = (item.rtl && item.bw ? item.x + item.bw : item.x) * scale,
        y = (item.y + item.size * 0.31) * scale;
      // Arabic is drawn right to left and sits at the right end of its field.
      ctx.direction = item.rtl ? "rtl" : "ltr";
      ctx.textAlign = item.rtl && item.bw ? "right" : "left";
      if (Math.abs(item.rot) < 0.01) ctx.fillText(item.text, x, y);
      else {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((-item.rot * Math.PI) / 180);
        ctx.fillText(item.text, 0, 0);
        ctx.restore();
      }
    }
  }
}

let arabicFont: Promise<unknown> | null = null;
/** Loads the Arabic font once for the canvas (the same Noto Naskh Arabic file the PDF embeds). */
export function loadArabicFont() {
  arabicFont ??= (async () => {
    try {
      const face = new FontFace("CWNaskh", "url(fonts/NotoNaskhArabic-Regular.ttf)");
      await face.load();
      document.fonts.add(face);
    } catch {
      // The preview then uses a system Arabic font.
    }
  })();
  return arabicFont;
}

function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cannot show the alignment photo."));
    image.src = `data:image/png;base64,${base64}`;
  });
}

/** PNG (base64, no prefix) of the preview at a fixed 1600 px width. */
export async function drawChequePreview(
  scene: PreviewScene,
  photo?: { format: "png"; data: string } | null,
): Promise<string> {
  const scale = WIDTH_PX / scene.widthMm;
  if (scene.printed.some((i) => i.k === "text" && i.rtl)) await loadArabicFont();
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH_PX;
  canvas.height = Math.round(scene.heightMm * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the cheque preview.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (photo?.data) ctx.drawImage(await loadImage(photo.data), 0, 0, canvas.width, canvas.height);
  else if (scene.guide) paint(ctx, scene.guide, scale);
  paint(ctx, scene.printed, scale);
  return canvas.toDataURL("image/png").split(",")[1];
}

/** Turns a chosen PNG/JPEG into a PNG of at most 2400 x 1600 px (done here: the server has no image library). */
export async function photoToPng(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Cannot read this cheque image. Use a valid PNG or JPEG."));
      el.src = url;
    });
    const ratio = Math.min(1, 2400 / image.naturalWidth, 1600 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot read the photo.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}
