import type { ArdiaCoreNativeModules } from "@ardia/ardiacore";
import { engineAvailable } from "../engine/host";
import { requireNativeModule } from "../modules";
import type { WindowsHostModule } from "../nativeModuleTypes";
import { expectTrue, type Check } from "./check";

const AWAY_SECONDS = 3600;
const QUIET_MS = 1100;

const host = () => requireNativeModule<Pick<WindowsHostModule, "inputIdleSeconds">>("ArdiaWindowsHost");
const engine = () => requireNativeModule<ArdiaCoreNativeModules["ArdiaEngine"]>("ArdiaEngine");

export const checks: Check[] = [
  {
    name: "input idle time counts the seconds since the last input, or an hour while another app is in front, and reaches ArdiaEngine",
    async run() {
      await new Promise<void>((resolve) => setTimeout(resolve, QUIET_MS));
      const idle = host().inputIdleSeconds();
      expectTrue(typeof idle === "number" && Number.isFinite(idle) && (idle === AWAY_SECONDS || (idle >= 1 && idle < AWAY_SECONDS * 24)), `inputIdleSeconds answered ${idle} after ${QUIET_MS} ms with no input`);
      if (!engineAvailable()) return;
      const viaEngine = engine().inputIdleSeconds();
      expectTrue(typeof viaEngine === "number" && Math.abs(viaEngine - host().inputIdleSeconds()) < 1, `ArdiaEngine.inputIdleSeconds answered ${String(viaEngine)}`);
    },
  },
];
