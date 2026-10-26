import { cn } from "@/lib/utils";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/** Form actions stay outside the scrolling fields, including in small windows. */
export function FormDialog({ title, onClose, children, footer, busy = false }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="sjmr-form-dialog-overlay">
    <div ref={panel} className="sjmr-form-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} tabIndex={-1} onKeyDown={e => {
      if ((e.target as HTMLElement).closest('[role="dialog"]') !== e.currentTarget) return;
      if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === e.currentTarget)) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="sjmr-form-dialog-header"><h2 id={titleId} className="font-semibold">{title}</h2><Button type="button" variant="secondary" disabled={busy} onClick={onClose} aria-label={`Close ${title}`}>Close</Button></header>
      <div className="sjmr-form-dialog-body"><fieldset className="sjmr-form-dialog-fields" disabled={busy}>{children}</fieldset></div>
      <footer className="sjmr-form-dialog-actions">{footer}</footer>
    </div>
  </div>, document.body);
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
}) {
  const styles = {
    primary: "bg-primary text-primary-fg hover:bg-primary-hover",
    secondary: "border border-border-strong bg-surface text-fg hover:bg-sunken",
    ghost: "text-fg hover:bg-sunken",
    danger: "bg-danger text-primary-fg hover:opacity-90",
    success: "border border-success/30 bg-success-bg text-success hover:opacity-90",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, type, step, onWheel, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      step={type === "number" ? step ?? 1 : step}
      onWheel={(e) => {
        if (type === "number") (e.currentTarget as HTMLInputElement).blur();
        onWheel?.(e);
      }}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg placeholder:text-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-medium text-muted", className)} {...props} />;
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(20,32,43,0.04)]", className)}
      {...props}
    />
  );
}

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "success" | "warn" | "danger" | "primary";
  children: ReactNode;
}) {
  const styles = {
    muted: "bg-sunken text-muted",
    success: "bg-success-bg text-success",
    warn: "bg-warn-bg text-warn",
    danger: "bg-danger-bg text-danger",
    primary: "bg-primary/10 text-primary",
  }[tone];
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide", styles)}>
      {children}
    </span>
  );
}

export function statusTone(status: string) {
  const s = status.toUpperCase();
  if (s === "PAID" || s === "CLOSED" || s === "RECEIVED") return "success" as const;
  if (s === "PARTIALLY_PAID" || s === "PARTIAL" || s === "SENT" || s === "ISSUED") return "warn" as const;
  if (s === "CANCELLED") return "danger" as const;
  return "muted" as const;
}

export function Alert({
  tone,
  children,
}: {
  tone: "danger" | "success" | "warn";
  children: ReactNode;
}) {
  const styles = {
    danger: "border-danger/30 bg-danger-bg text-danger",
    success: "border-success/30 bg-success-bg text-success",
    warn: "border-warn/30 bg-warn-bg text-warn",
  }[tone];
  return <div className={cn("rounded-lg border px-3 py-2 text-sm", styles)}>{children}</div>;
}
