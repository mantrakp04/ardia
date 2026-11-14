import { currentAirTraffic } from "../airTraffic/store";
import type { AirTrafficConfig } from "../airTraffic/rules";

let byRule = 0;
let byFallback = 0;

export const noteAirTrafficLink = (by: "rule" | "fallback") => void (by === "rule" ? byRule++ : byFallback++);

export function takeAirTrafficCounts() {
  const taken = { air_traffic_rule_links: byRule, air_traffic_fallback_links: byFallback };
  byRule = 0;
  byFallback = 0;
  return taken;
}

export const airTrafficSetting = (config: AirTrafficConfig): Record<string, string> => ({
  air_traffic_rules: String(config.rules.filter((r) => r.enabled).length),
  air_traffic_fallback: config.fallback ? "true" : "false",
});

export const airTrafficSnapshot = () => airTrafficSetting(currentAirTraffic());
