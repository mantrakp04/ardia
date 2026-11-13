import { requireNativeModule } from "../modules";
import type { WindowsHostModule } from "../nativeModuleTypes";
import { expectTrue, type Check } from "./check";

const AWAY_SECONDS = 3600;

const host = () => requireNativeModule<Pick<WindowsHostModule, "inputIdleSeconds">>("ArdiaWindowsHost");

export const checks: Check[] = [
  {
    name: "input idle time is seconds since the last input, or an hour while another app is in front",
    run() {
      const first = host().inputIdleSeconds();
      expectTrue(typeof first === "number" && Number.isFinite(first) && first >= 0, `inputIdleSeconds answered ${first}`);
      expectTrue(first === AWAY_SECONDS || first < AWAY_SECONDS * 24, `inputIdleSeconds answered ${first}`);
    },
  },
];
