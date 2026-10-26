export type Db = {
  exec(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  all(sql: string, params?: unknown[]): Promise<Record<string, any>[]>;
  close(): Promise<void>;
};
export type Host = {
  platform: string;
  dataFile: string;
  openDb(path: string, options: { readOnly: boolean }): Promise<Db>;
  runHelper(input: { args: string[]; job?: string; visible: boolean; timeoutMs: number; script?: string }): Promise<{ code: number; out: string; err: string }>;
  savePdf(base64: string, name: string): Promise<string | null>;
  pickOpen(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  pickSave(title: string, name: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  confirm(message: string, detail: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
  openFolder(): Promise<void>;
  about(): Promise<{ version: string; dataFolder: string; portable: boolean; runtime: string }>;
  replaceDataFile(source: string): Promise<void>;
  notify?(title: string, body: string): Promise<void> | void;
  applyAlertSettings?(settings: unknown, tip: string): Promise<void> | void;
  setTip?(text: string): Promise<void> | void;
  onNavigate(callback: (target: string) => void): () => void;
  now?(): Date;
};
export function createCore(host: Host): Promise<{
  invoke(name: string, ...args: unknown[]): Promise<unknown>;
  alertRound(): Promise<void>;
  startAlerts(): void;
  stop(): void;
}>;
