import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Tabs } from "@/components/bits";
import { api } from "@/lib/api";
import { CwProvider } from "@/lib/cw-context";
import { alertText, type AlertSummary } from "../shared/cheque-rules";
import { WriteTab } from "@/tabs/WriteTab";
import { ChequeListTab } from "@/tabs/ChequeListTab";
import { BanksTab } from "@/tabs/BanksTab";
import { PayeesTab } from "@/tabs/PayeesTab";
import { SettingsTab } from "@/tabs/SettingsTab";
import { TemplateTab } from "@/tabs/TemplateTab";

type TabId = "write" | "cheques" | "template" | "banks" | "payees" | "settings";

export function App() {
  const [tab, setTab] = useState<TabId>("write");
  const [filter, setFilter] = useState("all");
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [hidden, setHidden] = useState("");
  const go = useCallback((id: string, f?: string) => {
    setTab(id as TabId);
    if (f) setFilter(f);
  }, []);
  const refresh = useCallback(() => {
    api.alerts().then((a) => setSummary(a.summary)).catch(() => undefined);
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
          <div className="ml-auto text-right text-[13px] leading-snug text-ink-fg" aria-label="Branding">
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
              { id: "cheques", label: "Cheque List", badge: summary?.count || 0 },
              { id: "template", label: "Template Printer" },
              { id: "banks", label: "Banks & Layouts" },
              { id: "payees", label: "Payees" },
              { id: "settings", label: "Settings" },
            ]}
          />
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
          {tab === "cheques" && <ChequeListTab key={filter} initialFilter={filter} onChanged={refresh} />}
          {tab === "template" && <TemplateTab />}
          {tab === "banks" && <BanksTab />}
          {tab === "payees" && <PayeesTab />}
          {tab === "settings" && <SettingsTab onChanged={refresh} />}
        </main>
      </div>
    </CwProvider>
  );
}
