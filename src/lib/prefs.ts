// Small per-PC choices (not cheque data): kept in the browser storage of the program window.
export function getPref(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice is then simply not remembered.
  }
}
export type Theme = "light" | "dark";
export type TextSize = "normal" | "large" | "xlarge";
// The whole window is scaled (the text sizes are fixed in pixels), so every label, box and button grows together.
const SIZES: Record<TextSize, string> = { normal: "1", large: "1.15", xlarge: "1.3" };
export function applyLook() {
  const theme = getPref("cw.theme", "light") === "dark" ? "dark" : "light";
  const size = (getPref("cw.textSize", "normal") as TextSize) in SIZES ? (getPref("cw.textSize", "normal") as TextSize) : "normal";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.zoom = SIZES[size];
}
export const TEXT_SIZES: [TextSize, string][] = [["normal", "Normal"], ["large", "Large"], ["xlarge", "Extra large"]];
