import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorText, type AppState } from "./api";
import type { WriterConfig } from "./cheque-writer-model";

type Ctx = {
  state: AppState;
  reload: () => Promise<AppState>;
  setConfig: (config: WriterConfig) => void;
  go: (tab: string, filter?: string) => void;
  chequeFilter: string;
};
const Context = createContext<Ctx | null>(null);
export const useCw = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Not inside the app.");
  return value;
};

export function CwProvider({ children, go, chequeFilter }: { children: ReactNode; go: Ctx["go"]; chequeFilter: string }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const next = await api.state();
    setState(next);
    return next;
  }, []);
  useEffect(() => {
    reload().catch((e) => setError(errorText(e)));
  }, [reload]);
  if (error) return <div className="p-4 text-danger">{error}</div>;
  if (!state) return <div className="p-4 text-muted">Loading…</div>;
  return (
    <Context.Provider value={{ state, reload, setConfig: (config) => setState((old) => (old ? { ...old, config } : old)), go, chequeFilter }}>
      {children}
    </Context.Provider>
  );
}
