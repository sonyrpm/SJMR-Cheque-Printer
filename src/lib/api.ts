import type { AlertSettings, AlertSummary, Cheque, ChequeFilter, Status } from "../../shared/cheque-rules";
import type { Calibration, EnginePreviewData, EnginePrinter, NativeLayout, WriterConfig } from "./cheque-writer-model";

export type Account = { id: string; name: string; bankNo: string; currency: string; active: boolean; createdAt: string };
export type AppState = {
  config: WriterConfig;
  accounts: Account[];
  payees: string[];
  alerts: AlertSettings;
  summary: { accounts: number; cheques: number; payees: number };
  today: string;
};
export type OutputResult = {
  ok: boolean;
  cancelled: boolean;
  message: string;
  saved: { cheque: Cheque; updated: boolean } | null;
  listError?: string;
};
export type ImportReport = {
  accounts: number;
  accountsReused: number;
  cheques: number;
  chequesSkipped: number;
  ledgerEntries: number;
  layouts: number;
  payees: number;
  warnings: string[];
};
export type TemplatePrinterInfo = { name: string; is_default: boolean; papers: { name: string; width_mm: number; height_mm: number; is_a4: boolean }[] };
export type TemplateSaved = {
  dpi: number; width: number; height: number; copies: number; printer: string; paper: string; landscape: boolean; pageW: number; pageH: number;
  margin: number; gap: number; border: boolean; borderMm: number; hLines: boolean; vLines: boolean; offsetX: number; offsetY: number;
};
export type EngineRequest = Record<string, unknown>;
export type DesignInput =
  | { kind: "calibration"; revision: number; bankId: string; layoutId: string; calibration: Calibration }
  | { kind: "layouts"; revision: number; layouts: Record<string, NativeLayout>; replace: boolean }
  | { kind: "delete"; revision: number; id: string };

declare global {
  interface Window {
    cw: {
      platform: string;
      invoke(name: string, ...args: unknown[]): Promise<unknown>;
      onNavigate(callback: (target: string) => void): () => void;
    };
  }
}
const call = <T>(name: string, ...args: unknown[]) => window.cw.invoke(name, ...args) as Promise<T>;

export const api = {
  state: () => call<AppState>("state"),
  preview: (request: EngineRequest) => call<EnginePreviewData>("preview", request),
  printers: () => call<{ printers: EnginePrinter[] }>("printers"),
  image: (data: string) => call<{ background: { format: "png"; data: string } }>("image", data),
  nextChequeNo: (accountId: string) => call<string | null>("nextChequeNo", accountId),
  output: (input: { action: "direct" | "dialog" | "pdf"; request: EngineRequest; list: { accountId: string; layoutId: string } | null }) =>
    call<OutputResult>("output", input),
  templatePrinters: () => call<{ printers: TemplatePrinterInfo[] }>("templatePrinters"),
  templatePrint: (job: Record<string, unknown>) => call<{ ok: boolean; cancelled: boolean; message: string }>("templatePrint", job),
  templateSavePdf: (input: { base64: string; name: string }) => call<{ ok: boolean; cancelled: boolean; message: string; file: string | null }>("templateSavePdf", input),
  templateSettings: () => call<TemplateSaved>("templateSettings"),
  saveTemplateSettings: (input: TemplateSaved) => call<TemplateSaved>("saveTemplateSettings", input),
  saveDesign: (data: DesignInput) => call<WriterConfig>("saveDesign", data),
  saveAccount: (input: { id?: string; name: string; bankNo: string; currency: string; active?: boolean }) => call<Account>("saveAccount", input),
  deleteAccount: (id: string) => call<null>("deleteAccount", id),
  addPayee: (name: string) => call<string[]>("addPayee", name),
  removePayee: (name: string) => call<string[]>("removePayee", name),
  importPayees: (list: string[]) => call<{ added: number; payees: string[] }>("importPayees", list),
  replacePayees: (list: string[]) => call<string[]>("replacePayees", list),
  cheques: (filter: ChequeFilter = {}) => call<Cheque[]>("cheques", filter),
  chequeHistory: (id: string) => call<{ at: string; action: string; from_status: string | null; to_status: string | null; detail: string }[]>("chequeHistory", id),
  setStatus: (input: { id: string; to: Status; date?: string; reason?: string }) => call<Cheque>("setStatus", input),
  setStatusMany: (input: { ids: string[]; to: Status; date?: string; reason?: string }) => call<Cheque[]>("setStatusMany", input),
  setNote: (input: { id: string; note: string }) => call<Cheque>("setNote", input),
  setChequeDate: (input: { id: string; date: string | null }) => call<Cheque>("setChequeDate", input),
  deleteCheque: (id: string) => call<null>("deleteCheque", id),
  alerts: () => call<{ summary: AlertSummary; settings: AlertSettings; today: string }>("alerts"),
  saveAlerts: (input: AlertSettings) => call<AlertSettings>("saveAlerts", input),
  importOld: () => call<ImportReport | null>("importOld", ""),
  dataBackup: () => call<string | null>("dataBackup"),
  dataRestore: () => call<string | null>("dataRestore"),
  openDataFolder: () => call<string>("openDataFolder"),
  about: () => call<{ version: string; dataFolder: string; portable: boolean; runtime: string; developer?: boolean }>("about"),
};
export const errorText = (error: unknown) => (error instanceof Error ? error.message : "The action failed.");
