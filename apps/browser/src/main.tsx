import "./platform/nativeEvents";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppRegistry, unstable_batchedUpdates } from "react-native";
import { WindowRoot } from "./App";
import { DevErrorBoundary } from "./components/window/DevErrorBoundary";
import { startTranslate } from "./state/site/translate";
import { afterFirstWindow, firstWindowCommitted } from "./lib/afterFirstWindow";
import { startAppIntegration } from "./state/app/appIntegration";
import { startCliControl } from "./state/app/cliControl";
import { startUserScripts } from "./state/extensions/userScripts";
import { startKillSwitches } from "./platform/killSwitchesLaunch";
import { startMemoryTrim } from "./state/tabs/memoryTrim";
import { startNativeSync } from "./state/app/nativeSync";
import { startPersistence } from "./state/session/persist";
import { startNewTabBar } from "./state/omnibox/newTabBar";
import { perfMark, perfProbeEnabled, probeStore } from "./state/app/perfProbe";
import { startTabLifecycle } from "./state/tabs/tabLifecycle";
import { startTabPages } from "./state/tabs/tabPages";
import { startTabReveal } from "./state/tabs/tabReveal";
import { startSync } from "./state/sync/engine";
import { setStoreBatching, useBrowser } from "./state/browser/store";
import { installErrorReporting, startTelemetry } from "./state/telemetry";
import { launchCommitted } from "./state/telemetry/journeys";
import { markFirstWindow } from "./state/telemetry/track";

probeStore("browser", useBrowser);
installErrorReporting();
setStoreBatching(unstable_batchedUpdates);
startPersistence();
startNewTabBar();
startTabPages();
startTabReveal();
startNativeSync();
startAppIntegration();
startTabLifecycle();
startTranslate();
startSync();
startTelemetry();
startKillSwitches();
startCliControl();
afterFirstWindow(startUserScripts);
startMemoryTrim();
if (__DEV__ || perfProbeEnabled) require("./components/dev/devHarness").startDevHarness();

const devMountDelay = () => (__DEV__ ? ((globalThis as { acDevMountDelayMs?: number }).acDevMountDelayMs ?? 0) : 0);

function Root({ windowId }: { windowId: string }) {
  const [delay] = useState(devMountDelay);
  const [held, setHeld] = useState(delay > 0);
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setHeld(false), delay);
    return () => clearTimeout(timer);
  }, []);
  useLayoutEffect(() => launchCommitted(), []);
  useEffect(() => {
    perfMark("firstWindow");
    markFirstWindow();
    firstWindowCommitted();
  }, []);
  if (held) return null;
  return __DEV__ ? (
    <DevErrorBoundary>
      <WindowRoot windowId={windowId} />
    </DevErrorBoundary>
  ) : (
    <WindowRoot windowId={windowId} />
  );
}

AppRegistry.registerComponent("main", () => Root);
perfMark("bundleEnd");
