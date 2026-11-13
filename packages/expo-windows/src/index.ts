import { TurboModuleRegistry } from "react-native";
import type { AppWindowsModule, WindowsHostModule } from "./nativeModuleTypes";
import { installAnimation } from "./animation";
import { watchRelaunches } from "./engine/relaunch";
import { openLaunchLinks } from "./launchLinks";
import { requireNativeModule } from "./modules";
import { runSelfCheck } from "./selfCheck";
import { startUpdateChecks } from "./updater";
import { viewOnWindows } from "./views/registry";
import { installWindowRoot } from "./windowRoot";
import type { ComponentType } from "react";

export type { EventSubscription } from "./events";
export { emitNativeEvent } from "./events";
export { missingOnWindows } from "./missing";
export { requireNativeModule, requireOptionalNativeModule } from "./modules";

export function requireNativeViewManager<Props = object>(name: string): ComponentType<Props> {
  return viewOnWindows(name) as ComponentType<Props>;
}

const SELF_CHECK_AFTER_MS = 4000;

installAnimation();
installWindowRoot();
watchRelaunches();
openLaunchLinks();
startUpdateChecks();

const windowsHost = () => TurboModuleRegistry.getEnforcing<WindowsHostModule>("ArdiaWindowsHost");
const secureHex = (byteCount: number) => windowsHost().secureRandomHex(byteCount);

if (windowsHost().getConstants?.()?.selfCheck) {
  setTimeout(() => {
    void runSelfCheck().finally(() => requireNativeModule<Pick<AppWindowsModule, "quit">>("ArdiaAppWindows").quit());
  }, SELF_CHECK_AFTER_MS);
}

export const uuid = {
  v4() {
    const hex = secureHex(16);
    if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Windows gave no random bytes");
    const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  },
};
