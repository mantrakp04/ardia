import "./lib/productName";
import "./lib/nativeEvents";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppRegistry, unstable_batchedUpdates } from "react-native";
import { WindowRoot } from "./App";
import { DevErrorBoundary } from "./DevErrorBoundary";
import { startTranslate } from "./components/site/translate";
import { afterFirstWindow, firstWindowCommitted } from "./lib/afterFirstWindow";
import { startAppIntegration } from "./lib/appIntegration";
import { startCliControl } from "./lib/cliControl";
import { startUserScripts } from "./lib/userScripts";
import { startKillSwitches } from "./lib/killSwitchesLaunch";
import { startMemoryTrim } from "./lib/memoryTrim";
import { startNativeSync } from "./lib/native";
import { startPersistence } from "./lib/persist";
import { startNewTabBar } from "./components/omnibox/newTabBar";
import { perfMark, perfProbeEnabled, probeStore } from "./lib/perfProbe";
import { startTabLifecycle } from "./lib/tabLifecycle";
import { startTabPages } from "./lib/tabPages";
import { startTabReveal } from "./lib/tabReveal";
import { startSync } from "./sync/engine";
import { setStoreBatching, useBrowser } from "./store/browser";
import { installErrorReporting, startTelemetry } from "./telemetry";
import { launchCommitted } from "./telemetry/journeys";
import { markFirstWindow } from "./telemetry/track";

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
if (__DEV__ || perfProbeEnabled) require("./lib/devHarness").startDevHarness();

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
