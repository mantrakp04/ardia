import { diagnosticsSample, updaterState } from "../../platform/app";
import { withDeadline } from "../../lib/deadline";
import { diagnostics } from "../commands/appCommands";
import { environment } from "./client";
import { isSharing, savedChoice, sessionId } from "./choice";
import { contextSamples, hardwareProperties, sessionStart } from "./diagnostics";
import { appInfo } from "./transport";

const WAIT_MS = 1_500;

export type DiagnosticsSnapshot = {
  text: string;
  app_version: string;
  app_build: string;
  channel: string | null;
  os_version: string;
  arch: string;
  session_id: string;
  fields: Record<string, unknown>;
};

export const diagnosticsText = () => withDeadline(diagnostics(), WAIT_MS, "").catch(() => "");

export async function diagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  const info = appInfo();
  const [text, updates, sample, hardware] = await Promise.all([
    diagnosticsText(),
    withDeadline(updaterState(), WAIT_MS, null).catch(() => null),
    withDeadline(diagnosticsSample(), WAIT_MS, null).catch(() => null),
    hardwareProperties().catch(() => ({})),
  ]);
  const channel = updates?.available ? (updates.channel ?? updates.buildChannel ?? null) : null;
  const watch = savedChoice();
  return {
    text,
    app_version: info.appVersion,
    app_build: info.appBuild,
    channel,
    os_version: info.osVersion,
    arch: info.arch,
    session_id: sessionId(),
    fields: {
      configuration: info.configuration,
      environment: environment(),
      model: info.model,
      memory_gb: Math.round(info.memoryGB),
      locale: info.locale,
      in_applications_folder: info.inApplicationsFolder ?? null,
      session_minutes: Math.max(0, Math.round((Date.now() - sessionStart()) / 60_000)),
      footprint_mb: sample?.footprintMB ?? null,
      free_disk_gb: sample?.freeDiskGB === undefined || sample === null ? null : Math.round(sample.freeDiskGB),
      sharing: isSharing(),
      watch_report: watch.watchReport,
      watch_until: watch.watchUntil,
      automatic_update_checks: updates?.available ? (updates.automaticChecks ?? null) : null,
      ...hardware,
      recent_context: isSharing() ? contextSamples().slice(-3) : [],
    },
  };
}
