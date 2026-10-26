export type Status = "pending" | "cleared" | "returned" | "cancelled";
export const STATUSES: Status[];
export const STATUS_LABEL: Record<Status, string>;
export type AlertSettings = {
  enabled: boolean;
  daysAhead: number;
  overdueAfterDays: number;
  notify: boolean;
  startWithWindows: boolean;
  keepInTray: boolean;
};
export const DEFAULT_ALERTS: AlertSettings;
export type Cheque = {
  id: string;
  accountId: string;
  accountName?: string;
  chequeNo: string;
  payee: string;
  amount: string;
  currency: string;
  chequeDate: string | null;
  issuedOn: string;
  status: Status;
  statusDate: string | null;
  reason: string;
  note: string;
  layoutId: string;
  wording: string;
  createdAt: string;
};
export type DueKind = "none" | "today" | "soon" | "later" | "recent" | "overdue";
export function isIsoDate(text: unknown): boolean;
export function todayISO(now?: Date): string;
export function daysBetween(a: string, b: string): number;
export function dueInfo(
  cheque: Pick<Cheque, "status" | "chequeDate">,
  today: string,
  alerts?: AlertSettings,
): { kind: DueKind; days: number | null };
export type AlertSummary = { overdue: Cheque[]; today: Cheque[]; soon: Cheque[]; count: number };
export function alertSummary(cheques: Cheque[], today: string, alerts?: AlertSettings): AlertSummary;
export function alertText(summary: AlertSummary): string;
export function checkStatusChange(
  cheque: Pick<Cheque, "status" | "statusDate" | "reason">,
  to: Status,
  input?: { date?: string; reason?: string },
  today?: string,
): { status: Status; statusDate: string | null; reason: string };
export type ChequeFilter = {
  status?: "all" | "coming" | "attention" | Status;
  q?: string;
  accountId?: string;
  from?: string;
  to?: string;
};
export function filterCheques(rows: Cheque[], filter?: ChequeFilter, today?: string, alerts?: AlertSettings): Cheque[];
export function checkAlertSettings(input: unknown): AlertSettings;
export type PrintedValues = {
  number: string;
  payee: string;
  amount: string;
  date: string;
  blankDate: boolean;
  crossed: boolean;
  crossing: number;
  payeeCaps: boolean;
};
export function chequeFromPrint(input: {
  accountId: string;
  values: PrintedValues;
  currency: string;
  layoutId: string;
  wording: string;
  today?: string;
}): {
  accountId: string;
  chequeNo: string;
  payee: string;
  amount: string;
  currency: string;
  chequeDate: string | null;
  issuedOn: string;
  layoutId: string;
  wording: string;
  crossing: number;
};
export function chequeFromData(input: {
  accountId: string;
  data: Record<string, unknown>;
  layoutId: string;
  today?: string;
}): ReturnType<typeof chequeFromPrint>;
