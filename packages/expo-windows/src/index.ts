import { TurboModuleRegistry, type TurboModule } from "react-native";
import { installAnimatedEndValue } from "./animatedEndValue";
import { requireNativeModule } from "./modules";
import { runSelfCheck } from "./selfCheck";
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

type WindowsHost = TurboModule & { secureRandomHex(byteCount: number): string };

const SELF_CHECK_AFTER_MS = 4000;

installAnimatedEndValue();
installWindowRoot();

const windowsHost = () => TurboModuleRegistry.getEnforcing<WindowsHost>("ArdiaWindowsHost");
const secureHex = (byteCount: number) => windowsHost().secureRandomHex(byteCount);

if ((windowsHost().getConstants?.() as { selfCheck?: boolean } | undefined)?.selfCheck) {
  setTimeout(() => {
    void runSelfCheck().finally(() => requireNativeModule<{ quit(): Promise<void> }>("ArdiaAppWindows").quit());
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
