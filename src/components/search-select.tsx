import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui";
import { focusNextControl } from "@/lib/shortcuts";

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

export function SearchSelect<T extends { id: string }>({
  items,
  value,
  onChange,
  placeholder,
  getLabel,
  getHint,
  getCode,
  getMeta,
  emptyItems,
  disabled,
  displayValue,
  preserveTextUntilPick = false,
  onQueryCommit,
  onQueryChange,
  onSearch,
  searching = false,
  searchError = "",
  lineField,
  autoAdvance = true,
  onEnterAdvance,
  onCreate,
  createLabel = "Add",
  getCreateName,
}: {
  items: T[];
  value: string;
  onChange: (id: string, item?: T) => void;
  placeholder?: string;
  getLabel: (item: T) => string;
  getHint?: (item: T) => string;
  getCode?: (item: T) => string;
  /** Fix 122: text at the right of each option, for example the balance. */
  getMeta?: (item: T) => string;
  /** Fix 122: shown instead of `items` while nothing is typed (for example the parties with a recent bill). Typing searches `items`. */
  emptyItems?: T[];
  disabled?: boolean;
  displayValue?: string;
  /** Keep imported text/selection while filtering; only an explicit option pick replaces it. */
  preserveTextUntilPick?: boolean;
  onQueryCommit?: (q: string) => void;
  onQueryChange?: (q: string) => void;
  /** Debounced remote query. Typed text is not a selection. */
  onSearch?: (query: string) => void;
  searching?: boolean;
  searchError?: string;
  lineField?: string;
  autoAdvance?: boolean;
  /** When set, Enter moves here instead of the next field. Other screens stay on Tab order. */
  onEnterAdvance?: () => void;
  /** Explicit action only; typing/Enter retains the existing free-text behaviour. */
  onCreate?: (name: string) => void;
  createLabel?: string;
  getCreateName?: (item: T) => string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  // With preserveTextUntilPick the box starts with the saved text; the list is only narrowed once the person types.
  const [typed, setTyped] = useState(false);
  const [moved, setMoved] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === value);
  const remote = Boolean(onSearch);
  const filtered = useMemo(() => {
    if (remote) return items.slice(0, 80);
    const s = preserveTextUntilPick && !typed ? "" : q.trim().toLowerCase();
    if (!s && emptyItems) return emptyItems.slice(0, 80);
    const match = (item: T) =>
      `${getCode?.(item) || ""} ${getLabel(item)} ${getHint?.(item) || ""}`.toLowerCase().includes(s);
    if (!s) return items.slice(0, 80);
    return items.filter(match).slice(0, 80);
  }, [items, emptyItems, q, typed, preserveTextUntilPick, getLabel, getHint, getCode, remote]);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    if (!onSearchRef.current || !open) return;
    const timer = window.setTimeout(() => onSearchRef.current?.(q), 200);
    return () => window.clearTimeout(timer);
  }, [q, open]);

  useEffect(() => {
    setHi(0);
  }, [q, open]);

  const placeMenu = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 460), Math.max(220, window.innerWidth - 16));
    const maxH = 288;
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    if (left < 8) left = 8;
    const maxHeight = Math.min(maxH, Math.max(140, openUp ? spaceAbove : spaceBelow));
    const top = openUp ? Math.max(8, r.top - gap - maxHeight) : r.bottom + gap;
    setMenuPos({ top, left, width, maxHeight });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const node = menuRef.current?.querySelector('[aria-selected="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  // The form emptied the box from outside (next cheque): forget the old typing and close the list.
  useEffect(() => {
    if (preserveTextUntilPick && displayValue === "") {
      setQ("");
      setTyped(false);
      setOpen(false);
    }
  }, [displayValue, preserveTextUntilPick]);
  const shown = open ? q : preserveTextUntilPick && displayValue !== undefined ? displayValue : displayValue || (selected ? getLabel(selected) : q);

  const pick = (item: T, fromEnter = false) => {
    onChange(item.id, item);
    setQ("");
    setOpen(false);
    if (fromEnter && onEnterAdvance) {
      window.setTimeout(() => onEnterAdvance(), 10);
      return;
    }
    if (autoAdvance) {
      window.setTimeout(() => {
        const input = wrapRef.current?.querySelector("input");
        if (input) focusNextControl(input);
      }, 10);
    }
  };

  const commitQuery = () => {
    if (!preserveTextUntilPick && onQueryCommit && q.trim()) onQueryCommit(q.trim());
    setOpen(false);
  };

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="search-select-menu"
            role="listbox"
            data-search-menu="1"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {searchError ? (
              <div className="search-select-empty">{searchError}</div>
            ) : filtered.length ? (
              filtered.map((item, idx) => {
                const code = getCode?.(item)?.trim() || "";
                const name = getLabel(item);
                const hint = getHint?.(item) || "";
                const meta = getMeta?.(item) || "";
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={idx === hi}
                    className="search-select-option"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHi(idx)}
                    onClick={() => pick(item)}
                  >
                    {code ? <span className="search-opt-code">{code}</span> : null}
                    <span className="search-opt-name">{name}</span>
                    {hint ? <span className="search-opt-hint">{hint}</span> : null}
                    {meta ? <span className="search-opt-meta">{meta}</span> : null}
                  </button>
                );
              })
            ) : (
              <div className="search-select-empty">{searching ? "Searching…" : q.trim() && onQueryCommit && !preserveTextUntilPick ? "Enter to use this text" : preserveTextUntilPick && q.trim() ? "No saved name matches. The text you typed is used as it is." : "No match"}</div>
            )}
            {onCreate && q.trim() && !searching && !searchError && !items.some(item => (getCreateName ? getCreateName(item) : getLabel(item)).trim().toLowerCase() === q.trim().toLowerCase()) ? (
              <button type="button" className="search-select-option text-primary" onMouseDown={e => e.preventDefault()} onClick={() => { const name = q.trim(); setOpen(false); onCreate(name); }}>
                {createLabel} “{q.trim()}”
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative" data-search-select="" ref={wrapRef}>
      <Input
        disabled={disabled}
        placeholder={placeholder || "Search"}
        value={shown}
        data-line-field={lineField}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setTyped(true);
          setMoved(false);
          onQueryChange?.(e.target.value);
          setOpen(true);
          if (!e.target.value && !preserveTextUntilPick) onChange("");
        }}
        onFocus={() => {
          setOpen(true);
          setQ(preserveTextUntilPick ? shown : "");
          setTyped(false);
          setMoved(false);
          setHi(0);
        }}
        onBlur={(e) => {
          const input = e.currentTarget;
          window.setTimeout(() => {
            if (document.activeElement === input) return;
            if (!preserveTextUntilPick && open && q.trim() && !value) commitQuery();
            setOpen(false);
          }, 180);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setMoved(true);
            setHi((i) => Math.min(Math.max(filtered.length - 1, 0), i + 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setMoved(true);
            setHi((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Enter") {
            // Free text (payee): Enter keeps what was typed unless a suggestion was chosen with the arrow keys.
            if (preserveTextUntilPick && open && !moved) {
              setOpen(false);
              return;
            }
            if (open && filtered[hi]) {
              e.preventDefault();
              e.stopPropagation();
              pick(filtered[hi]!, true);
              return;
            }
            if (!preserveTextUntilPick && open && onQueryCommit && q.trim()) {
              e.preventDefault();
              e.stopPropagation();
              commitQuery();
              const input = e.currentTarget;
              window.setTimeout(() => {
                if (onEnterAdvance) onEnterAdvance();
                else focusNextControl(input);
              }, 10);
              return;
            }
            if (onEnterAdvance && !open) {
              e.preventDefault();
              onEnterAdvance();
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQ("");
            return;
          }
          if (!preserveTextUntilPick && e.key === "Tab" && open && filtered[hi] && q.trim()) {
            pick(filtered[hi]!);
          }
        }}
      />
      {menu}
    </div>
  );
}
