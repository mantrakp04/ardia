import { engineInfo, systemInfo, updaterState } from "../../platform/app";
import { useBrowser } from "../browser/store";
import { activeTab } from "../browser/model";
import { diagnosticsSnapshot } from "../telemetry/diagnosticsSnapshot";
import { settingsSnapshot } from "../telemetry/settingsSnapshot";
import type { ReportDraft } from "./form";

export type SystemDetails = Record<string, string | number | null>;

export async function systemDetails(): Promise<SystemDetails> {
  const app = systemInfo();
  const [engine, snapshot] = await Promise.all([engineInfo().catch(() => null), diagnosticsSnapshot().catch(() => null)]);
  const s = useBrowser.getState();
  const regular = s.windowOrder.filter((id) => s.windows[id]?.kind !== "private");
  return {
    app: `${app.appName} ${app.appVersion} (${app.appBuild})`,
    configuration: app.configuration,
    engine: engine ? `Chromium ${engine.chromiumVersion}` : null,
    macos: `${app.osVersion} (${app.osBuild})`,
    arch: app.arch,
    model: app.model,
    memory_gb: Math.round(app.memoryGB),
    locale: app.locale,
    windows: regular.length,
    private_windows: s.windowOrder.length - regular.length,
    tabs: Object.keys(s.tabs).length,
    profiles: s.profileOrder.length,
    ...flat(snapshot?.fields ?? {}),
  };
}

const flat = (fields: Record<string, unknown>): SystemDetails =>
  Object.fromEntries(Object.entries(fields).filter((e): e is [string, string | number | null] => e[1] === null || typeof e[1] === "string" || typeof e[1] === "number"));

export function systemLine(): string {
  const app = systemInfo();
  return [`${app.appName} ${app.appVersion}`, `macOS ${app.osVersion}`, app.model, `${Math.round(app.memoryGB)} GB`].filter(Boolean).join(" · ");
}

export async function updateChannel(): Promise<string | null> {
  const state = await updaterState().catch(() => null);
  return state?.available ? (state.channel ?? state.buildChannel ?? null) : null;
}

export function pageAddressOf(windowId: string): string | null {
  const url = activeTab(useBrowser.getState(), windowId)?.url ?? null;
  return url && /^https?:/i.test(url) ? url : null;
}

export async function reportDiagnostics(draft: ReportDraft, localLines: number | null): Promise<Record<string, unknown>> {
  return {
    ...(draft.attach.system ? { system: await systemDetails() } : {}),
    ...(draft.attach.settings ? { settings: settingsSnapshot(useBrowser.getState().settings) } : {}),
    ...(draft.attach.errors && localLines !== null ? { local_events: { lines: localLines, days: 7 } } : {}),
  };
}
