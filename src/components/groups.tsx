import { useState, type ReactNode } from "react";

const KEY = "cw.groups";
// Kept in memory too, so a group still opens and closes where the browser blocks storage.
const memory: Record<string, boolean> = {};
function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? { ...raw, ...memory } : { ...memory };
  } catch {
    return { ...memory };
  }
}
function saveOpen(id: string, open: boolean) {
  memory[id] = open;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readOpen(), [id]: open }));
  } catch {
    // Storage can be blocked; the choice then lasts until the window closes.
  }
}

/** A titled block that opens and closes. The content stays mounted, so values typed inside are never lost. */
export function Group({
  id,
  title,
  summary,
  defaultOpen = true,
  locked = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  /** True: everything inside is read only (a disabled fieldset) and the title says Locked. */
  locked?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    const saved = readOpen();
    return Object.hasOwn(saved, id) ? saved[id] === true : defaultOpen;
  });
  const toggle = () =>
    setOpen((old) => {
      saveOpen(id, !old);
      return !old;
    });
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface" data-group={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`group-${id}`}
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken"
      >
        <span aria-hidden className={`inline-block text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-sm font-semibold">{title}</span>
        {(summary || locked) && (
          <span className="ml-auto truncate text-xs font-normal text-muted">
            {locked ? `Locked${summary ? ` · ${summary}` : ""}` : summary}
          </span>
        )}
      </button>
      <div id={`group-${id}`} hidden={!open} className="space-y-3 border-t border-border px-3 py-3">
        {locked ? (
          <fieldset disabled className="m-0 min-w-0 space-y-3 border-0 p-0">
            {children}
          </fieldset>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
