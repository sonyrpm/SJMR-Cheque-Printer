import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tick({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-2 text-[13px]", disabled && "opacity-50")}>
      <input className="mt-0.5" type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Tab strip: same quiet look as the Accounting screens. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border bg-surface px-3">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium",
            value === tab.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab.label}
          {!!tab.badge && <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-4 text-primary-fg" aria-label={`${tab.badge} need attention`}>{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", active ? "border-primary bg-primary text-primary-fg" : "border-border-strong bg-surface text-fg hover:bg-sunken")}
    >
      {children}
    </button>
  );
}
