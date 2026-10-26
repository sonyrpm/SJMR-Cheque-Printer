import layouts from "../../shared/bank-layouts.json";
import type { NativeLayout } from "./cheque-writer-model";
/** The 42 built-in bank layouts. The same file is used by the app core. */
export const BANK_LAYOUTS = layouts as unknown as Record<string, NativeLayout>;
