import {
  cliControlStatus,
  installCli,
  installedCliVersion,
  onCliControlChanged,
  onCliInstallLine,
  setCliActiveTab,
  setCliControl,
  type CliControlStatus,
  type CliInstallResult,
} from "../../platform/cli";
import { readDocument, writeDocument } from "../../platform/documents";
import { systemInfo } from "../../platform/app";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../browser/store";
import { hasPage } from "../tabs/pageSession";
import { shownPageId } from "../peek/peek";
import { isTabReady, pageOf, usePages } from "../tabs/pageState";
import { isInternalTab } from "../pages/urls";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

const DOC = "ardia-cli.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
const SCHEMA_FIELD = "schemaVersion";
const UPGRADE_DELAY_MS = 8000;
const INDICATOR_HOLD_MS = 3000;

type Saved = { binPath?: string | null; version?: string | null; error?: string | null; at?: number };

export type CliInstallReason = "onboarding" | "settings" | "upgrade";

type CliState = {
  server: CliControlStatus | null;
  installing: CliInstallReason | null;
  step: string | null;
  installedVersion: string | null;
  binPath: string | null;
  error: string | null;
};

function readSaved(): Saved {
  try {
    return (parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS, SCHEMA_FIELD) as Saved | null) ?? {};
  } catch {
    return {};
  }
}

function save(patch: Saved) {
  try {
    writeDocument(DOC, versionedJson({ ...readSaved(), ...patch, at: Date.now() }, DOC_VERSION, SCHEMA_FIELD));
  } catch (error) {
    console.warn("[cli] couldn't save the install status", error);
  }
}

const saved = readSaved();

export const useCli = create<CliState>()(() => ({
  server: null,
  installing: null,
  step: null,
  installedVersion: installedCliVersion(),
  binPath: saved.binPath ?? null,
  error: saved.error ?? null,
}));

export const useCliIndicator = create<{ shown: boolean }>()(() => ({ shown: false }));

let indicatorHide: ReturnType<typeof setTimeout> | null = null;

function updateIndicator({ server }: CliState) {
  const on = server?.state === "on";
  const connected = on && (server.connections ?? 0) > 0;
  if (connected || !on) {
    if (indicatorHide) clearTimeout(indicatorHide);
    indicatorHide = null;
    if (useCliIndicator.getState().shown !== connected) useCliIndicator.setState({ shown: connected });
    return;
  }
  if (!useCliIndicator.getState().shown || indicatorHide) return;
  indicatorHide = setTimeout(() => {
    indicatorHide = null;
    useCliIndicator.setState({ shown: false });
  }, INDICATOR_HOLD_MS);
}

useCli.subscribe(updateIndicator);

let running: Promise<CliInstallResult> | null = null;

export function installCliInBackground(reason: CliInstallReason): Promise<CliInstallResult> {
  if (running) return running;
  useCli.setState({ installing: reason, step: null });
  const lines = onCliInstallLine((line) => {
    const step = /^step (\S+)/.exec(line)?.[1];
    if (step) useCli.setState({ step });
  });
  running = installCli()
    .catch((e: unknown): CliInstallResult => ({ ok: false, appVersion: "", error: e instanceof Error ? e.message : String(e), lines: [] }))
    .then((result) => {
      lines.remove();
      running = null;
      const installedVersion = installedCliVersion();
      if (result.ok) {
        save({ binPath: result.binPath ?? null, version: result.version ?? installedVersion, error: null });
        useCli.setState({ installing: null, step: null, installedVersion, binPath: result.binPath ?? null, error: null });
      } else {
        const error = result.error ?? "The installer stopped.";
        save({ error });
        useCli.setState({ installing: null, step: null, installedVersion, error });
      }
      return result;
    });
  return running;
}

export function describeCliInstall(state: Pick<CliState, "installing" | "step" | "installedVersion" | "binPath" | "error">): string {
  if (state.installing) return state.step ? `Installing (${state.step})…` : "Installing…";
  if (state.error) return state.error;
  if (state.installedVersion) return state.binPath ? `Installed at ${state.binPath}` : `Version ${state.installedVersion} is installed.`;
  return "Not installed.";
}

let sentActive: string | null | undefined;

function shownReadyTab(s: BrowserState): string | null {
  const windowId = s.ui.focusedWindowId;
  const id = windowId ? shownPageId(s, windowId) : undefined;
  const tab = id ? s.tabs[id] : undefined;
  if (!id || !tab?.url || pageOf(id).newTabShown || !hasPage(tab) || isInternalTab(tab)) return null;
  return isTabReady(id) ? id : null;
}

function pushActiveTab() {
  const state = useCli.getState().server?.state;
  if (state !== "on" && state !== "starting") {
    sentActive = undefined;
    return;
  }
  const active = shownReadyTab(useBrowser.getState());
  if (active === sentActive) return;
  sentActive = active;
  void setCliActiveTab(active).catch(() => {});
}

export function noteTabReady(tabId: string) {
  if (sentActive === tabId) sentActive = undefined;
  pushActiveTab();
}

export const stopCliControl = () => useBrowser.getState().updateSettings({ cliControl: false });

function upgradeIfBehind() {
  const installed = installedCliVersion();
  useCli.setState({ installedVersion: installed });
  const app = systemInfo().appVersion;
  if (!installed || !app || installed === app) return;
  void installCliInBackground("upgrade");
}

let started = false;

export function startCliControl() {
  if (started) return;
  started = true;
  let latest = 0;
  let inFlight = 0;
  let newest = 0;
  const apply = (server: CliControlStatus, mayReconcile: boolean) => {
    if ((server.generation ?? newest) < newest) return;
    newest = Math.max(newest, server.generation ?? 0);
    useCli.setState({ server });
    const stoppedItself = server.state === "off" && !!server.reason;
    if (mayReconcile && stoppedItself && useBrowser.getState().settings.cliControl) useBrowser.getState().updateSettings({ cliControl: false });
  };
  onCliControlChanged((server) => apply(server, inFlight === 0));
  let applied: boolean | null = null;
  const sync = () => {
    const on = useBrowser.getState().settings.cliControl ?? false;
    if (on === applied) return;
    const first = applied === null;
    applied = on;
    const request = ++latest;
    inFlight++;
    const settle = (server: CliControlStatus) => {
      inFlight--;
      if (request === latest) apply(server, true);
    };
    const call = first && !on ? cliControlStatus() : setCliControl(on);
    void call.then(settle, (e: unknown) => settle({ state: "off", reason: e instanceof Error ? e.message : String(e) }));
  };
  sync();
  useBrowser.subscribe(() => {
    sync();
    pushActiveTab();
  });
  useCli.subscribe(pushActiveTab);
  usePages.subscribe(pushActiveTab);
  afterFirstWindow(() => setTimeout(upgradeIfBehind, UPGRADE_DELAY_MS));
}

if (__DEV__) (globalThis as { acCli?: unknown }).acCli = { store: useCli, indicator: useCliIndicator, install: installCliInBackground, upgradeIfBehind };
