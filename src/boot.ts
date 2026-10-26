import { Buffer } from "buffer";
import { createCore, type Host } from "../core/index.mjs";

declare global {
  interface Window {
    __CW_HOST__?: Host;
  }
}

/** Starts the app core and puts its one door on `window.cw`. The Windows shell (Tauri) or a test supplies the host. */
export async function boot(): Promise<void> {
  (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
  const host = window.__CW_HOST__ ?? (await (await import("./lib/host-tauri")).tauriHost());
  const core = await createCore(host);
  window.cw = { platform: host.platform, invoke: (name, ...args) => core.invoke(name, ...args), onNavigate: (callback) => host.onNavigate(callback) };
  if (!window.__CW_HOST__) {
    core.startAlerts();
    void smokeCheck(core);
  }
}

/** Build pipeline only: with CW_SMOKE=1 the program reports what the window shows and ends. */
async function smokeCheck(core: { invoke(name: string, ...args: unknown[]): Promise<unknown> }) {
  const { invoke } = await import("@tauri-apps/api/core");
  if (!(await invoke<string | null>("smoke_env"))) return;
  await new Promise((r) => setTimeout(r, 2500));
  let text = "";
  try {
    const state = (await core.invoke("state")) as { config: { layouts: object }; accounts: unknown[] };
    text = `SMOKE_TEXT ${JSON.stringify(document.body.innerText.slice(0, 300))}\nSMOKE_OK ${JSON.stringify({ layouts: Object.keys(state.config.layouts).length, accounts: state.accounts.length })}\n`;
  } catch (error) {
    text = `SMOKE_FAILED ${error instanceof Error ? error.message : String(error)}\n`;
  }
  await invoke("smoke_done", { text });
}
