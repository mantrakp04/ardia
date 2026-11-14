import { currentAirTraffic } from "../airTraffic/store";
import type { AirTrafficConfig } from "../airTraffic/rules";

export type AirTrafficRouted = "rule" | "fallback" | "click" | "typed" | "group";

const ROUTED: AirTrafficRouted[] = ["rule", "fallback", "click", "typed", "group"];
const counts = Object.fromEntries(ROUTED.map((by) => [by, 0])) as Record<AirTrafficRouted, number>;

export const noteAirTrafficLink = (by: AirTrafficRouted) => void counts[by]++;

export function takeAirTrafficCounts() {
  const taken = Object.fromEntries(ROUTED.map((by) => [`air_traffic_${by}_links`, counts[by]]));
  for (const by of ROUTED) counts[by] = 0;
  return taken;
}

export const airTrafficSetting = (config: AirTrafficConfig): Record<string, string> => {
  const enabled = config.rules.filter((r) => r.enabled);
  return {
    air_traffic_rules: String(enabled.length),
    air_traffic_fallback: config.fallback ? "true" : "false",
    air_traffic_inside_rules: String(enabled.filter((r) => r.inside).length),
    air_traffic_group_rules: String(enabled.filter((r) => r.groupKey).length),
  };
};

export const airTrafficSnapshot = () => airTrafficSetting(currentAirTraffic());
