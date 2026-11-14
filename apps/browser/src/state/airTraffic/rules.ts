import { isFields } from "../../lib/decode";
import { sourceMatches, type LinkSource } from "../../lib/linkSource";
import { matchesUrl, parseMatchPattern, type MatchSpec } from "../../lib/matchPattern";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { urlParts } from "../../lib/urlParts";

export const AIR_TRAFFIC_DOC = "air-traffic.json";
export const AIR_TRAFFIC_VERSION = 1;
export const MAX_AIR_TRAFFIC_RULES = 100;
const MIGRATIONS: Migrations = { 0: unchanged };

export const OPEN_AS = ["tab", "window", "littleArdia"] as const;
export type OpenAs = (typeof OPEN_AS)[number];
export type SourceApp = { bundleId: string | null; name: string };
export type LinkCondition = { kind: "any" } | { kind: "site"; host: string } | { kind: "pattern"; pattern: string };
export type AirTrafficTarget = { profileId: string | null; open: OpenAs; groupKey?: string };
export type AirTrafficRule = AirTrafficTarget & { id: string; enabled: boolean; from: SourceApp | null; when: LinkCondition; inside: boolean };
export type AirTrafficConfig = { rules: AirTrafficRule[]; fallback: AirTrafficTarget | null };
export type TargetUsable = (profileId: string, groupKey: string | null) => boolean;
export type AirTrafficMatch = { by: "rule"; rule: AirTrafficRule; index: number; target: AirTrafficTarget } | { by: "fallback"; target: AirTrafficTarget };

export const NO_AIR_TRAFFIC: AirTrafficConfig = { rules: [], fallback: null };

export function siteHost(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (text.includes("://")) {
    const parts = urlParts(text);
    if (!parts?.host) return null;
    text = parts.host;
  } else text = text.split(/[/?#]/)[0]!;
  text = text.replace(/^\*\./, "").replace(/\.$/, "");
  if (!text) return null;
  const spec = parseMatchPattern(`*://*.${text}/*`);
  return "error" in spec || !spec.host ? null : spec.host;
}

export function patternProblem(pattern: string): string | null {
  const spec = parseMatchPattern(pattern.trim());
  return "error" in spec ? spec.error : null;
}

const compiled = new Map<string, MatchSpec | null>();

function specOf(pattern: string): MatchSpec | null {
  if (!compiled.has(pattern)) {
    const spec = parseMatchPattern(pattern);
    if (compiled.size > 500) compiled.clear();
    compiled.set(pattern, "error" in spec ? null : spec);
  }
  return compiled.get(pattern)!;
}

export function linkMatches(when: LinkCondition, url: string): boolean {
  if (when.kind === "any") return true;
  const spec = specOf(when.kind === "site" ? `*://*.${when.host}/*` : when.pattern);
  return !!spec && matchesUrl(spec, url);
}

export const appMatches = (from: SourceApp | null, source: LinkSource) => !from || sourceMatches([from.bundleId ?? from.name], source);

export const targetUsable = (target: AirTrafficTarget, usable: TargetUsable) => target.profileId === null || usable(target.profileId, target.groupKey ?? null);

const targetOf = (target: AirTrafficTarget): AirTrafficTarget => ({ profileId: target.profileId, open: target.open, ...(target.groupKey ? { groupKey: target.groupKey } : {}) });

export function cleanTarget<T extends AirTrafficTarget>(target: T): T {
  const { groupKey, ...rest } = target;
  return (groupKey && target.profileId !== null && target.open === "tab" ? { ...rest, groupKey } : rest) as T;
}

export const cleanRule = (rule: AirTrafficRule): AirTrafficRule => cleanTarget({ ...rule, inside: rule.inside === true && rule.from === null });

export const sameTarget = (a: AirTrafficTarget | null, b: AirTrafficTarget | null) =>
  a === b || (!!a && !!b && a.profileId === b.profileId && a.open === b.open && (a.groupKey ?? null) === (b.groupKey ?? null));

export function airTrafficRule(config: AirTrafficConfig, url: string, source: LinkSource, usable: TargetUsable): AirTrafficMatch | null {
  const index = config.rules.findIndex((r) => r.enabled && appMatches(r.from, source) && linkMatches(r.when, url) && targetUsable(r, usable));
  if (index < 0) return null;
  const rule = config.rules[index]!;
  return { by: "rule", rule, index, target: targetOf(rule) };
}

export function airTrafficFallback(config: AirTrafficConfig, usable: TargetUsable): AirTrafficMatch | null {
  return config.fallback && targetUsable(config.fallback, usable) ? { by: "fallback", target: targetOf(config.fallback) } : null;
}

export const airTrafficHolds = (config: AirTrafficConfig) => !!config.fallback || config.rules.some((r) => r.enabled);

const isOpenAs = (v: unknown): v is OpenAs => OPEN_AS.includes(v as OpenAs);
const isProfileRef = (v: unknown): v is string | null => v === null || (typeof v === "string" && !!v);

export function sourceAppOf(v: unknown): SourceApp | null {
  if (!isFields(v) || typeof v.name !== "string" || !v.name.trim()) return null;
  if (v.bundleId !== null && (typeof v.bundleId !== "string" || !v.bundleId.trim())) return null;
  return { bundleId: (v.bundleId as string | null) ?? null, name: v.name.trim() };
}

function conditionOf(v: unknown): LinkCondition | null {
  if (!isFields(v)) return null;
  if (v.kind === "any") return { kind: "any" };
  if (v.kind === "site" && typeof v.host === "string" && siteHost(v.host) === v.host) return { kind: "site", host: v.host };
  if (v.kind === "pattern" && typeof v.pattern === "string" && !patternProblem(v.pattern)) return { kind: "pattern", pattern: v.pattern };
  return null;
}

function targetFrom(v: unknown): AirTrafficTarget | null {
  if (!isFields(v) || !isProfileRef(v.profileId) || !isOpenAs(v.open)) return null;
  const grouped = typeof v.groupKey === "string" && !!v.groupKey && v.profileId !== null && v.open === "tab";
  return { profileId: v.profileId, open: v.open, ...(grouped ? { groupKey: v.groupKey as string } : {}) };
}

function ruleOf(v: unknown): AirTrafficRule | null {
  if (!isFields(v) || typeof v.id !== "string" || !v.id || typeof v.enabled !== "boolean") return null;
  const from = v.from === null ? null : sourceAppOf(v.from);
  const when = conditionOf(v.when);
  const target = targetFrom(v);
  if ((v.from !== null && !from) || !when || !target) return null;
  return { id: v.id, enabled: v.enabled, from, when, ...target, inside: v.inside === true && from === null };
}

export function parseAirTraffic(json: string | null | undefined): AirTrafficConfig {
  const doc = parseSaved(json, AIR_TRAFFIC_VERSION, MIGRATIONS);
  if (!doc) return NO_AIR_TRAFFIC;
  const seen = new Set<string>();
  const rules = (Array.isArray(doc.rules) ? doc.rules : [])
    .map(ruleOf)
    .filter((r): r is AirTrafficRule => !!r && !seen.has(r.id) && !!seen.add(r.id))
    .slice(0, MAX_AIR_TRAFFIC_RULES);
  return { rules, fallback: doc.fallback === null || doc.fallback === undefined ? null : targetFrom(doc.fallback) };
}

export const airTrafficJson = (config: AirTrafficConfig) => versionedJson({ rules: config.rules, fallback: config.fallback }, AIR_TRAFFIC_VERSION);
