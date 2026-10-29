import "../../browser/src/state/browser/store";
import "./base.css";
import "./styles.css";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { unstable_batchedUpdates } from "react-native";
import { emitCommand, menuShown, setWindowCloseDecider } from "@ardia/shell";
import { WindowRoot } from "../../browser/src/App";
import { startNativeSync } from "../../browser/src/state/app/nativeSync";
import { startTabPages } from "../../browser/src/state/tabs/tabPages";
import { startTabLifecycle, useLifecycle } from "../../browser/src/state/tabs/tabLifecycle";
import { useMedia } from "../../browser/src/state/media/media";
import { useToolbarAutoHide } from "../../browser/src/state/windows/toolbarAutoHide";
import { copyLinkToSelection, jumpToSelection, replaceInField, usePageSelection } from "../../browser/src/state/site/selection";
import { webviews } from "../../browser/src/platform/webviews";
import { startMemoryTrim } from "../../browser/src/state/tabs/memoryTrim";
import { setNewTabPrewarm } from "../../browser/src/state/tabs/prewarm";
import { setStoreBatching, useBrowser, type HydrateData } from "../../browser/src/state/browser/store";
import { usePages } from "../../browser/src/state/tabs/pageState";
import { useOnboarding } from "../../browser/src/state/onboarding/onboarding";
import { adoptParkedPins } from "../../browser/src/state/pins/parkedPins";
import { decideLastTabClose, decideWindowClose } from "../../browser/src/state/windows/windowClose";
import { firstWindowCommitted } from "../../browser/src/lib/afterFirstWindow";
import { recordFreshProfile, startAppCommands, startLinuxAppServices, UTILITY_APP_COMMANDS } from "./appServices";
import { linuxCapabilities } from "./hostCapabilities";
import { useExtensions } from "../../browser/src/state/extensions/store";
import { openExtensionFromMenu } from "../../browser/src/state/extensions/bridge";
import { ardiaHost, invokeHost } from "./host";
import { setSharedCommands } from "./shims/expo-modules-core";
import { COMMANDS } from "../../browser/src/state/commands/commandCatalog";
import { linuxSessionShape, startHostPersistence } from "./hostSession";
import { startHostData } from "./hostData";
import { startHostDownloads } from "./hostDownloads";
import { startHostTabLifecycle } from "./hostTabLifecycle";
import { startLinuxTabPolicies, TAB_POLICY_CHANNEL, watchHostInputActivity } from "./hostPolicies";
import { watchInstallPromptCancellations } from "./extensionPrompts";
import { followExtensionChanges } from "./utilityExtensions";
import { refreshExtensionsAfterChange } from "../../browser/src/state/extensions/actions";
import { provideNativeModuleProvider, requireNativeModule } from "./shims/expo-modules-core";
import { setHostPageHooks } from "./hostPageHooks";
import { applyHostPageTheme, forgetDepartedPage, resetHostPage } from "./hostPageLifecycle";
import { setHostOverlayCheck } from "./hostViewport";
import { setPopupDismissal } from "./popupDismissal";
import { MenuHost } from "./menus";
import { startPopoverEscape } from "./popoverEscape";
import { startLinuxShortcuts } from "./shortcutsRuntime";
import { linuxWindowMenu, TrafficLights } from "./TrafficLights";
import { createUtilitySessionSnapshot, initialLinuxSession, isLinuxUtility, setSessionDeparture, setSessionFlush } from "./session";
import { startUtility } from "./utility";
import { installProfileWindows } from "./hostWindowProfiles";
import { focus } from "../../browser/src/state/browser/actions";
import { announceCommandsReady, announceTypeaheadReady, windowExpectsField } from "./typeahead";
import { linuxSyncHooks, startLinuxSync } from "./syncEngine";
import { linuxLiveHooks } from "./liveHooks";
import { connectCalendar, refreshCalendar, setCalendarHidden, useCalendar } from "../../browser/src/state/live/calendar";
import { useMeetingAlert } from "../../browser/src/state/live/alerts";

Object.assign(globalThis, { ardiaLinux: { store: useBrowser, pages: usePages, emitCommand, extensions: useExtensions, openExtension: openExtensionFromMenu, webviews, media: useMedia, lifecycle: { state: useLifecycle }, sync: linuxSyncHooks, live: linuxLiveHooks, toolbar: useToolbarAutoHide, windowMenu: linuxWindowMenu, selection: { state: usePageSelection, jump: jumpToSelection, copyQuoteLink: copyLinkToSelection, replaceInField }, calendar: { state: useCalendar, connect: connectCalendar, refresh: refreshCalendar, hide: setCalendarHidden, alert: useMeetingAlert } } });
setHostPageHooks({ reset: resetHostPage, applyTheme: applyHostPageTheme, depart: (tabId) => ardiaHost && forgetDepartedPage(tabId, ardiaHost.bootstrap.windowId) });
setWindowCloseDecider((windowId, reason, ask) => reason === "lastTab" ? decideLastTabClose(windowId, ask) : decideWindowClose(windowId, ask));

function FirstWindowCommitted({ typeahead }: { typeahead: boolean }) {
  useEffect(() => {
    firstWindowCommitted();
    if (typeahead && ardiaHost) {
      announceCommandsReady(ardiaHost);
      announceTypeaheadReady(ardiaHost, { expectsField: () => windowExpectsField(useBrowser.getState(), ardiaHost!.bootstrap.windowId, useOnboarding.getState().windowId) });
    }
  }, [typeahead]);
  return null;
}

async function start() {
  setSharedCommands((command) => Object.hasOwn(COMMANDS, command));
  if (!ardiaHost) throw new Error("The Linux desktop UI requires an Ardia native host");
  setNewTabPrewarm(false);
  const { windowId, profileId } = ardiaHost.bootstrap;
  const utility = isLinuxUtility(windowId);
  const stored = ardiaHost.bootstrap.session ?? await invokeHost<HydrateData | null>("session.read", {});
  const saved = stored ? linuxSessionShape(stored) : stored;
  setStoreBatching(unstable_batchedUpdates);
  useBrowser.getState().hydrate(initialLinuxSession(ardiaHost, saved));
  await startLinuxShortcuts(ardiaHost);
  if (utility) {
    const persistence = startHostPersistence(ardiaHost, useBrowser, saved ?? {}, createUtilitySessionSnapshot(useBrowser.getState(), saved ?? {}));
    setSessionFlush(persistence.flush);
    startHostData();
    startAppCommands(windowId, linuxCapabilities(ardiaHost), undefined, UTILITY_APP_COMMANDS);
    startLinuxSync({ host: ardiaHost, candidate: false });
    followExtensionChanges(ardiaHost, () => useExtensions.getState().lists, refreshExtensionsAfterChange);
    await startUtility(ardiaHost);
  } else {
    if (!ardiaHost.bootstrap.privateWindow) useBrowser.setState(adoptParkedPins(useBrowser.getState(), windowId, profileId));
    installProfileWindows(useBrowser, focus);
    startHostData();
    startHostTabLifecycle(ardiaHost, useBrowser);
    setHostOverlayCheck((key) => {
      const state = useBrowser.getState();
      const owner = key && state.tabs[key];
      const ui = owner ? state.windowUi[owner.windowId] : undefined;
      const pages = usePages.getState();
      const page = key ? pages.pages[key] : undefined;
      return !!(ui?.panel.open || ui?.downloadsOpen || menuShown() || page?.permission || page?.passwordPrompt || page?.autofillPrompt || page?.externalApp || key && pages.popover[key]);
    });
    setPopupDismissal({ popup: () => useExtensions.getState().popup, windowOf: (tabId) => useBrowser.getState().tabs[tabId]?.windowId, close: () => useExtensions.setState({ popup: null }) });
    startPopoverEscape({ target: window, windowId, menuShown, activeElement: () => document.activeElement });
    const persistence = startHostPersistence(ardiaHost, useBrowser, saved ?? {});
    setSessionFlush(persistence.flush);
    setSessionDeparture(persistence);
    if (!saved) await recordFreshProfile();
    await persistence.flush();
    startTabPages();
    startNativeSync();
    startHostDownloads(ardiaHost, useBrowser);
    startLinuxTabPolicies({
      target: window, provide: provideNativeModuleProvider, startLifecycle: startTabLifecycle, startTrim: startMemoryTrim,
      windowId, locks: navigator.locks, channel: new BroadcastChannel(TAB_POLICY_CHANNEL), privateWindow: !!ardiaHost.bootstrap.privateWindow,
      activity: (listener) => watchHostInputActivity(requireNativeModule("ArdiaEngine"), listener),
    });
    watchInstallPromptCancellations(ardiaHost, useExtensions);
    startLinuxSync({ host: ardiaHost, candidate: true, locks: navigator.locks });
    startLinuxAppServices({
      host: ardiaHost,
      windowId,
      savedSession: !!saved,
      capabilities: linuxCapabilities(ardiaHost),
      locks: navigator.locks,
      marks: sessionStorage,
    });
  }
  createRoot(document.getElementById("root")!, { onUncaughtError: (error) => console.error("[ardia linux] crashed", error) }).render(
    <div className={`ardia-desktop host ardia-linux${utility ? " utility" : ""}`} data-ardia-linux-window={windowId}>
      <div className="ardia-window">
        <WindowRoot windowId={windowId} />
        <TrafficLights windowId={windowId} />
      </div>
      <MenuHost />
      <FirstWindowCommitted typeahead={!utility} />
    </div>,
  );
}

void start().catch((error) => {
  console.error("[ardia linux] startup failed", error);
  const root = document.getElementById("root");
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = `Ardia could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
});
