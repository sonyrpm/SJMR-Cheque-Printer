import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Tabs } from "@/components/bits";
import { api } from "@/lib/api";
import { CwProvider, useCw } from "@/lib/cw-context";
import { alertText, type AlertSummary } from "../shared/cheque-rules";
import { WriteTab } from "@/tabs/WriteTab";
import { ChequeListTab } from "@/tabs/ChequeListTab";
import { BanksTab } from "@/tabs/BanksTab";
import { PayeesTab } from "@/tabs/PayeesTab";
import { SettingsTab } from "@/tabs/SettingsTab";
import { TemplateTab } from "@/tabs/TemplateTab";
import { BatchTab } from "@/tabs/BatchTab";
import { HelpDialog } from "@/components/help";
import { applyLook } from "@/lib/prefs";

type TabId = "write" | "batch" | "cheques" | "template" | "banks" | "payees" | "settings";
const ORDER: TabId[] = ["write", "batch", "cheques", "template", "banks", "payees", "settings"];

export function App() {
  const [tab, setTab] = useState<TabId>("write");
  const [filter, setFilter] = useState("all");
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [hidden, setHidden] = useState("");
  const [help, setHelp] = useState(false);
  const [staleHidden, setStaleHidden] = useState(false);
  const go = useCallback((id: string, f?: string) => {
    setTab(id as TabId);
    if (f) setFilter(f);
  }, []);
  const refresh = useCallback(() => {
    api.alerts().then((a) => setSummary(a.summary)).catch(() => undefined);
  }, []);
  useEffect(() => {
    applyLook();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        setHelp(true);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-7]$/.test(e.key) && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setTab(ORDER[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    const off = window.cw.onNavigate((target) => {
      if (target === "cheques-attention") go("cheques", "attention");
      else go(target);
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      off();
    };
  }, [refresh, go]);
  const text = summary?.count ? alertText(summary) : "";
  return (
    <CwProvider go={go} chequeFilter={filter}>
      <div className="cw-shell">
        <header className="flex items-center gap-3 border-b border-border bg-ink px-4 py-2 text-ink-fg">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">SJ</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">SJMR Cheque Writer</div>
            <div className="text-[11px] text-ink-muted">Write, print and keep track of cheques</div>
          </div>
          <Button variant="ghost" className="ml-auto min-h-7 text-ink-fg hover:bg-white/10" aria-label="Help" title="Help (F1)" onClick={() => setHelp(true)}>? Help</Button>
          <div className="text-right text-[13px] leading-snug text-ink-fg" aria-label="Branding">
            <div className="font-medium">Powered by sonyrpm</div>
            <div className="text-ink-muted">www.sjmrsoft.com · info@sjmrsoft.com</div>
          </div>
        </header>
        <div>
          <Tabs
            value={tab}
            onChange={(id) => {
              setTab(id);
              refresh();
            }}
            tabs={[
              { id: "write", label: "Write & Print" },
              { id: "batch", label: "Batch" },
              { id: "cheques", label: "Cheque List", badge: summary?.count || 0 },
              { id: "template", label: "Template Printer" },
              { id: "banks", label: "Banks & Layouts" },
              { id: "payees", label: "Payees" },
              { id: "settings", label: "Settings" },
            ]}
          />
          <BackupNotice go={go} />
          {text && hidden !== text && tab !== "cheques" && (
            <div role="status" className="flex items-center gap-3 border-b border-warn/30 bg-warn-bg px-4 py-1.5 text-[13px] text-warn">
              <span className="font-medium">Cheque alert:</span>
              <span className="flex-1">{text}.</span>
              <Button variant="secondary" className="min-h-7 px-2 text-xs" onClick={() => go("cheques", "attention")}>View</Button>
              <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => setHidden(text)}>Hide</Button>
            </div>
          )}
        </div>
        <main className="cw-main">
          <div hidden={tab !== "write"}><WriteTab onListChanged={refresh} /></div>
          {tab === "batch" && <BatchTab onListChanged={refresh} />}
          {tab === "cheques" && <ChequeListTab key={filter} initialFilter={filter} onChanged={refresh} />}
          {tab === "template" && <TemplateTab />}
          {tab === "banks" && <BanksTab />}
          {tab === "payees" && <PayeesTab />}
          {tab === "settings" && <SettingsTab onChanged={refresh} />}
        </main>
      </div>
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </CwProvider>
  );
}

/** Warns when no copy of the data has been saved for a week (the daily automatic copy normally prevents this). */
function BackupNotice({ go }: { go: (tab: string) => void }) {
  const { state } = useCw();
  const [hidden, setHidden] = useState(false);
  if (hidden || !state.summary.cheques) return null;
  const days = state.lastBackup ? Math.round((Date.parse(state.today) - Date.parse(state.lastBackup)) / 86400000) : null;
  if (days !== null && days < 7) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warn/30 bg-warn-bg px-4 py-1.5 text-[13px] text-warn">
      <span className="flex-1">{days === null ? "No copy of your cheque data has been saved yet." : `The last copy of your cheque data is ${days} days old.`}</span>
      <Button variant="secondary" className="min-h-7 px-2 text-xs" onClick={() => go("settings")}>Save a copy</Button>
      <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => setHidden(true)}>Hide</Button>
    </div>
  );
}
