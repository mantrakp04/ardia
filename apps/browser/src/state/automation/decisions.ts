import { isFields } from "../../lib/decode";
import { minimizedUrl, originOf as urlOrigin, urlParts } from "../../lib/urlParts";
import { anyMatches, matchesUrl } from "../../lib/matchPattern";
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

export function decide<A>(event: DecideEvent, data: Record<string, unknown>, plan: Plan<A>, signal?: AbortSignal): A | null | Promise<A | null> {
  for (const hook of decideHooks(event)) {
    if (!plan.applies(hook) || !activeHook(hook)) continue;
    if (hook.rules) {
      const verdict = plan.rule(hook);
      if (verdict === undefined) continue;
      return verdict;
    }
    if (servingConnection(hook) === null) return null;
    const sent = hook.fullUrls || typeof data.url !== "string" ? data : { ...data, url: minimizedUrl(data.url) };
    return requestDecision(hook, event, sent, DECIDE_DEADLINE_MS[event], signal).then(
      (answer) => (answer === undefined || answer === null ? null : plan.answer(answer)),
      () => null,
    );
  }
  return null;
}

const urlApplies = (hook: HookSpec, url: string) => !hook.specs.length || anyMatches(hook.specs, url);

function eligibleContext(context: { windowId: string | null; profileId: string | null }): boolean {
  const s = useBrowser.getState();
  if (context.profileId && isIncognitoProfile(context.profileId)) return false;
  if (context.windowId && s.windows[context.windowId] && !eligibleKind(s, context.windowId)) return false;
  return true;
}

export function decideOpening(url: string, context: OpeningContext, signal?: AbortSignal): OpeningVerdict | Promise<OpeningVerdict> {
  if (!eligibleContext(context)) return null;
  const data = { url, via: context.via, windowId: context.windowId, tabId: context.tabId, profile: context.profileId };
  const changed = (target: string | null): OpeningVerdict => (target && target !== url ? { url: target } : null);
  return decide<NonNullable<OpeningVerdict>>("tab.opening", data, {
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
  }, signal);
}

export type LinkSource = { bundleId: string | null; appName: string | null } | null;
export type LinkVerdict = { drop: true } | { profileId: string | null; open: "tab" | "littleArdia" | "window" | null; windowId: string | null };

const fromApplies = (hook: HookSpec, source: LinkSource) => {
  if (!hook.from.length) return true;
  const names = [source?.bundleId, source?.appName].filter((n): n is string => !!n).map((n) => n.toLowerCase());
  return hook.from.some((f) => names.includes(f.toLowerCase()));
};

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
  return { profileId, open: (open as "tab" | "littleArdia" | "window" | undefined) ?? null, windowId };
}

export function decideLink(url: string, source: LinkSource, signal?: AbortSignal): LinkVerdict | null | Promise<LinkVerdict | null> {
  const data = { url, source: source ?? { bundleId: null, appName: null } };
  return decide<LinkVerdict>("link.opening", data, {
    applies: (hook) => urlApplies(hook, url) && fromApplies(hook, source),
    rule: (hook) => (hook.rules!.drop ? { drop: true } : routeOf(hook.rules!.route!.profile ?? undefined, hook.rules!.route!.open ?? undefined, undefined)),
    answer: (answer) => {
      if (!isFields(answer)) return null;
      if (answer.drop === true) return { drop: true };
      return routeOf(answer.profile, answer.open, answer.window);
    },
  }, signal);
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
