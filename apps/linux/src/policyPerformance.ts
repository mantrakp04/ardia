import { setBatterySaver as setSharedBatterySaver } from "../../browser/src/platform/performance";
import { sharedBatterySaver } from "./hostPolicies";

export * from "../../browser/src/platform/performance";

export function setBatterySaver(...[mode]: Parameters<typeof setSharedBatterySaver>): ReturnType<typeof setSharedBatterySaver> {
  return sharedBatterySaver(mode, () => setSharedBatterySaver(mode));
}
