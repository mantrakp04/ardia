import { isFields } from "../../lib/decode";
import { minimizedUrl, originOf as urlOrigin, urlParts } from "../../lib/urlParts";
import { anyMatches, matchesUrl } from "../../lib/matchPattern";
import { sourceMatches, type LinkSource as SourceInfo } from "../../lib/linkSource";
import { airTrafficFallback, airTrafficRule, type AirTrafficRule, type AirTrafficTarget, type OpenAs } from "../airTraffic/rules";
import { currentAirTraffic, targetUsableNow } from "../airTraffic/store";
import { noteAirTrafficLink } from "../telemetry/airTrafficCounts";
import { isIncognitoProfile } from "../browser/model";
import { useBrowser } from "../browser/store";
import type { OpeningContext, OpeningVerdict } from "../tabs/openingGate";
import { eligibleKind } from "./automationWindows";
import { DECIDE_DEADLINE_MS, type DecideEvent } from "./eventNames";
import type { HookSpec } from "./hookFile";
import { isInsideDownloads, rewriteOf, safeRewriteTarget } from "./hookPolicy";
import { activeHook, decideHooks } from "./hookRules";
import { requestDecision, servingConnection } from "./decideSocket";

type Plan<A> = {
  applies(hook: HookSpec): boolean;
  rule(hook: HookSpec): A | null | undefined;
  answer(answer: unknown): A | null;
};

type Deciding<A> = { hook: HookSpec; verdict: A | null } | { hook: HookSpec; program: true };

function decidingHook<A>(event: DecideEvent, plan: Plan<A>): Deciding<A> | null {
  for (const hook of decideHooks(event)) {
    if (!plan.applies(hook) || !activeHook(hook)) continue;
    if (!hook.rules) return { hook, program: true };
    const verdict = plan.rule(hook);
    if (verdict !== undefined) return { hook, verdict };
  }
  return null;
}

function askHook<A>(hook: HookSpec, event: DecideEvent, data: Record<string, unknown>, plan: Plan<A>, signal?: AbortSignal): Promise<A | null> | null {
  if (servingConnection(hook) === null) return null;
  const sent = hook.fullUrls || typeof data.url !== "string" ? data : { ...data, url: minimizedUrl(data.url) };
  return requestDecision(hook, event, sent, DECIDE_DEADLINE_MS[event], signal).then(
    (answer) => (answer === undefined || answer === null ? null : plan.answer(answer)),
    () => null,
  );
}

export function decide<A>(event: DecideEvent, data: Record<string, unknown>, plan: Plan<A>, signal?: AbortSignal): A | null | Promise<A | null> {
  const found = decidingHook(event, plan);
  if (!found) return null;
  if ("verdict" in found) return found.verdict;
  return askHook(found.hook, event, data, plan, signal);
}

const urlApplies = (hook: HookSpec, url: string) => !hook.specs.length || anyMatches(hook.specs, url);

function eligibleContext(context: { windowId: string | null; profileId: string | null }): boolean {
  const s = useBrowser.getState();
  if (context.profileId && isIncognitoProfile(context.profileId)) return false;
  if (context.windowId && s.windows[context.windowId] && !eligibleKind(s, context.windowId)) return false;
  return true;
}

function openingPlan(url: string): Plan<NonNullable<OpeningVerdict>> {
  const changed = (target: string | null): OpeningVerdict => (target && target !== url ? { url: target } : null);
  return {
    applies: (hook) => urlApplies(hook, url),
    rule: (hook) => {
      if (hook.rules!.cancel) return { cancel: true };
      const target = rewriteOf(hook.rules!.rewrite ?? [], url, (r) => matchesUrl(r.spec, url));
      if (target === undefined) return undefined;
      return changed(target);
    },
    answer: (answer) => {
      if (!isFields(answer)) return null;
      if (answer.cancel === true) return { cancel: true };
      return typeof answer.url === "string" ? changed(safeRewriteTarget(answer.url)) : null;
    },
  };
}

export function decideOpening(url: string, context: OpeningContext, signal?: AbortSignal): OpeningVerdict | Promise<OpeningVerdict> {
  if (!eligibleContext(context)) return null;
  const data = { url, via: context.via, windowId: context.windowId, tabId: context.tabId, profile: context.profileId };
  return decide<NonNullable<OpeningVerdict>>("tab.opening", data, openingPlan(url), signal);
}

export type OpeningTrace = { by: "none" } | { by: "cancel"; hook: string } | { by: "rewrite"; hook: string; url: string } | { by: "program"; hook: HookSpec };

export function traceOpening(url: string): OpeningTrace {
  const found = decidingHook("tab.opening", openingPlan(url));
  if (!found) return { by: "none" };
  if ("program" in found) return { by: "program", hook: found.hook };
  if (found.verdict && "cancel" in found.verdict) return { by: "cancel", hook: found.hook.name };
  if (found.verdict) return { by: "rewrite", hook: found.hook.name, url: found.verdict.url };
  return { by: "none" };
}

export type LinkSource = SourceInfo;
export type LinkVerdict = { drop: true } | LinkRoute;
type LinkRoute = { profileId: string | null; open: OpenAs | null; windowId: string | null; groupKey: string | null };

const fromApplies = (hook: HookSpec, source: LinkSource) => sourceMatches(hook.from, source);

export function profileNamed(given: unknown): string | null {
  if (typeof given !== "string" || !given) return null;
  const s = useBrowser.getState();
  const id = s.profiles[given] ? given : s.profileOrder.find((p) => s.profiles[p]?.name.toLowerCase() === given.toLowerCase());
  return id && !isIncognitoProfile(id) ? id : null;
}

const OPEN = new Set(["tab", "littleArdia", "window"]);

function routeOf(profile: unknown, open: unknown, window: unknown): LinkVerdict | null {
  const profileId = profile === undefined ? null : profileNamed(profile);
  if (profile !== undefined && !profileId) return null;
  if (open !== undefined && (typeof open !== "string" || !OPEN.has(open))) return null;
  const s = useBrowser.getState();
  const windowId = typeof window === "string" && eligibleKind(s, window) === "normal" ? window : null;
  if (window !== undefined && !windowId) return null;
  return { profileId, open: (open as OpenAs | undefined) ?? null, windowId, groupKey: null };
}

const linkData = (url: string, source: LinkSource) => ({ url, source: source ?? { bundleId: null, appName: null } });

const linkPlan = (url: string, source: LinkSource): Plan<LinkVerdict> => ({
  applies: (hook) => urlApplies(hook, url) && fromApplies(hook, source),
  rule: (hook) => (hook.rules!.drop ? { drop: true } : routeOf(hook.rules!.route!.profile ?? undefined, hook.rules!.route!.open ?? undefined, undefined)),
  answer: (answer) => {
    if (!isFields(answer)) return null;
    if (answer.drop === true) return { drop: true };
    return routeOf(answer.profile, answer.open, answer.window);
  },
});

type LinkSettled = { by: "fallback"; verdict: LinkRoute } | { by: "usual" };
export type LinkTrace =
  | { by: "rule"; rule: AirTrafficRule; index: number; verdict: LinkRoute }
  | { by: "hook"; hook: string; verdict: LinkVerdict }
  | { by: "program"; hook: HookSpec; otherwise: LinkSettled }
  | LinkSettled;

const routeTo = (target: AirTrafficTarget): LinkRoute => ({ profileId: target.profileId, open: target.open, windowId: null, groupKey: target.groupKey ?? null });

function settledLink(): LinkSettled {
  const fallback = airTrafficFallback(currentAirTraffic(), targetUsableNow);
  return fallback ? { by: "fallback", verdict: routeTo(fallback.target) } : { by: "usual" };
}

export function traceLink(url: string, source: LinkSource): LinkTrace {
  const ruled = airTrafficRule(currentAirTraffic(), url, source, targetUsableNow);
  if (ruled?.by === "rule") return { by: "rule", rule: ruled.rule, index: ruled.index, verdict: routeTo(ruled.target) };
  const found = decidingHook("link.opening", linkPlan(url, source));
  if (found && "program" in found) return { by: "program", hook: found.hook, otherwise: settledLink() };
  if (found?.verdict) return { by: "hook", hook: found.hook.name, verdict: found.verdict };
  return settledLink();
}

function settle(trace: Exclude<LinkTrace, { by: "program" }>): LinkVerdict | null {
  if (trace.by === "rule" || trace.by === "fallback") noteAirTrafficLink(trace.by);
  return trace.by === "usual" ? null : trace.verdict;
}

export function decideLink(url: string, source: LinkSource, signal?: AbortSignal): LinkVerdict | null | Promise<LinkVerdict | null> {
  const trace = traceLink(url, source);
  if (trace.by !== "program") return settle(trace);
  const asked = askHook(trace.hook, "link.opening", linkData(url, source), linkPlan(url, source), signal);
  if (asked === null) return settle(trace.otherwise);
  return asked.then((verdict) => verdict ?? settle(settledLink()));
}

export type PermissionVerdict = "deny" | "ask";

export function decidePermission(request: { tabId: string | null; origin: string; permissions: string[] }, signal?: AbortSignal): PermissionVerdict | Promise<PermissionVerdict> {
  const s = useBrowser.getState();
  const tab = request.tabId ? s.tabs[request.tabId] : undefined;
  if (!tab || !eligibleContext({ windowId: tab.windowId, profileId: tab.profileId })) return "ask";
  const page = `${request.origin.replace(/\/$/, "")}/`;
  const data = { origin: request.origin, kinds: request.permissions, windowId: tab.windowId, tabId: tab.id, profile: tab.profileId };
  const verdict = decide<PermissionVerdict>("permission.requested", data, {
    applies: (hook) => urlApplies(hook, page) && (!hook.kinds.length || request.permissions.some((k) => hook.kinds.includes(k))),
    rule: (hook) => (hook.rules!.permission === "deny" ? "deny" : "ask"),
    answer: (answer) => (isFields(answer) && answer.permission === "deny" ? "deny" : "ask"),
  }, signal);
  if (verdict instanceof Promise) return verdict.then((v) => v ?? "ask");
  return verdict ?? "ask";
}

export function downloadFolderAllowed(folder: string, approvedFolders: readonly string[]): boolean {
  if (!folder.startsWith("~/") || folder.split("/").some((part) => part === ".." || part === "." || part === "")) return false;
  return isInsideDownloads(folder) || approvedFolders.some((f) => folder === f || folder.startsWith(`${f}/`));
}

export type FinishedDownload = { url: string; filename: string; mimeType: string; size: number; path: string; profile: string | null };

const originOf = (url: string) => {
  const parts = urlParts(url);
  return parts?.authority ? urlOrigin(parts) : null;
};

export function decideDownload(download: FinishedDownload, approvedFolders: readonly string[], signal?: AbortSignal): string | null | Promise<string | null> {
  if (download.profile && isIncognitoProfile(download.profile)) return null;
  const folderOf = (folder: unknown) => (typeof folder === "string" && downloadFolderAllowed(folder, approvedFolders) ? folder : null);
  const data = { url: download.url, origin: originOf(download.url), filename: download.filename, mime: download.mimeType, size: download.size, path: download.path, profile: download.profile };
  return decide<string>("download.deciding", data, {
    applies: (hook) => urlApplies(hook, download.url),
    rule: (hook) => (downloadFolderAllowed(hook.rules!.folder!, [hook.rules!.folder!]) ? hook.rules!.folder! : null),
    answer: (answer) => (isFields(answer) ? folderOf(answer.folder) : null),
  }, signal);
}
