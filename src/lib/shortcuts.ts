/** Enter in a list box moves to the next control, like the Accounting screens. */
export function focusNextControl(from: HTMLElement) {
  const root = from.closest("main") || document.body;
  const list = [
    ...root.querySelectorAll<HTMLElement>(
      "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
    ),
  ].filter((el) => el.offsetParent !== null);
  const next = list[list.indexOf(from) + 1];
  next?.focus();
  if (next instanceof HTMLInputElement && next.type !== "checkbox") next.select();
  return next || null;
}
