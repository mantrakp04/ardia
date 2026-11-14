import { create } from "zustand";
import { readDocument, writeDocument } from "../../platform/documents";
import type { LinkSource } from "../../lib/linkSource";
import { isIncognitoProfile } from "../browser/model";
import { useBrowser } from "../browser/store";
import {
  AIR_TRAFFIC_DOC,
  MAX_AIR_TRAFFIC_RULES,
  NO_AIR_TRAFFIC,
  airTrafficJson,
  parseAirTraffic,
  cleanRule,
  cleanTarget,
  sameTarget,
  type AirTrafficConfig,
  type AirTrafficRule,
  type AirTrafficTarget,
  type SourceApp,
} from "./rules";
import { hasRouteGroup } from "./groups";
import { LINK_SOURCES_DOC, parseRecentApps, recentAppsJson, withRecentApp } from "./sourceApps";

type Store = { loaded: boolean; config: AirTrafficConfig; recentApps: readonly SourceApp[] };

export const useAirTraffic = create<Store>()(() => ({ loaded: false, config: NO_AIR_TRAFFIC, recentApps: [] }));

function read(doc: string): string | null {
  try {
    return readDocument(doc);
  } catch {
    return null;
  }
}

function write(doc: string, json: string): boolean {
  try {
    writeDocument(doc, json);
    return true;
  } catch (error) {
    console.warn(`[airTraffic] couldn't save ${doc}`, error);
    return false;
  }
}

export function loadAirTraffic() {
  if (useAirTraffic.getState().loaded) return;
  useAirTraffic.setState({ loaded: true, config: parseAirTraffic(read(AIR_TRAFFIC_DOC)), recentApps: parseRecentApps(read(LINK_SOURCES_DOC)) });
}

export function currentAirTraffic(): AirTrafficConfig {
  loadAirTraffic();
  return useAirTraffic.getState().config;
}

export const targetUsableNow = (profileId: string, groupKey: string | null) => {
  const s = useBrowser.getState();
  return !!s.profiles[profileId] && !isIncognitoProfile(profileId) && (!groupKey || hasRouteGroup(s, profileId, groupKey));
};

function saveConfig(change: (config: AirTrafficConfig) => AirTrafficConfig) {
  const before = currentAirTraffic();
  const config = change(before);
  if (config === before || !write(AIR_TRAFFIC_DOC, airTrafficJson(config))) return;
  useAirTraffic.setState({ config });
}

const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export type RuleDraft = Omit<AirTrafficRule, "id">;

export function addAirTrafficRule(draft: RuleDraft): string | null {
  const id = newRuleId();
  let added = false;
  saveConfig((c) => {
    if (c.rules.length >= MAX_AIR_TRAFFIC_RULES) return c;
    added = true;
    return { ...c, rules: [...c.rules, cleanRule({ ...draft, id })] };
  });
  return added ? id : null;
}

export function updateAirTrafficRule(id: string, patch: Partial<RuleDraft>) {
  saveConfig((c) => (c.rules.some((r) => r.id === id) ? { ...c, rules: c.rules.map((r) => (r.id === id ? cleanRule({ ...r, ...patch, id }) : r)) } : c));
}

export function removeAirTrafficRule(id: string) {
  saveConfig((c) => (c.rules.some((r) => r.id === id) ? { ...c, rules: c.rules.filter((r) => r.id !== id) } : c));
}

export function moveAirTrafficRule(id: string, step: -1 | 1) {
  saveConfig((c) => {
    const from = c.rules.findIndex((r) => r.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= c.rules.length) return c;
    const rules = [...c.rules];
    [rules[from], rules[to]] = [rules[to]!, rules[from]!];
    return { ...c, rules };
  });
}

export function setAirTrafficFallback(given: AirTrafficTarget | null) {
  const fallback = given && cleanTarget(given);
  saveConfig((c) => (sameTarget(c.fallback, fallback) ? c : { ...c, fallback }));
}

export function noteLinkSource(source: LinkSource) {
  loadAirTraffic();
  const before = useAirTraffic.getState().recentApps;
  const recentApps = withRecentApp(before, source);
  if (recentApps === before) return;
  useAirTraffic.setState({ recentApps });
  write(LINK_SOURCES_DOC, recentAppsJson(recentApps));
}

export function resetAirTrafficForTests(config: AirTrafficConfig = NO_AIR_TRAFFIC, recentApps: readonly SourceApp[] = []) {
  useAirTraffic.setState({ loaded: true, config, recentApps });
}
