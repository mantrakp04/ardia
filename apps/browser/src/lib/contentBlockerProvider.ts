import type { ContentBlockerProvider, ContentBlockerState } from "@ardia/ardiacore";

export const PROVIDER_TITLES: Record<ContentBlockerProvider, string> = { ublock: "uBlock Origin", adnauseam: "AdNauseam" };

export type RunningStatus = "running" | "starting" | "failed" | "blockingOff";

export const runningStatus = (s: ContentBlockerState): RunningStatus =>
  !s.stats.ready ? (s.stats.error ? "failed" : "starting") : s.enabled ? "running" : "blockingOff";

const RUNNING_SENTENCES: Record<RunningStatus, string> = {
  running: "is running.",
  starting: "is starting.",
  failed: "didn't start.",
  blockingOff: "is loaded, with blocking off.",
};

export function runningProviderText(s: ContentBlockerState) {
  return `${PROVIDER_TITLES[s.provider]}${s.version ? ` ${s.version}` : ""} ${RUNNING_SENTENCES[runningStatus(s)]}`;
}

export const switchOnContinueText = (provider: ContentBlockerProvider) => `${PROVIDER_TITLES[provider]} activates when you continue. No restart needed.`;

export const providerStatusText = (s: ContentBlockerState, retry = "Select it again to retry.") =>
  s.selectedProvider !== s.provider
    ? `${runningProviderText(s)} ${PROVIDER_TITLES[s.selectedProvider]} could not be activated. ${retry}`
    : runningProviderText(s);
