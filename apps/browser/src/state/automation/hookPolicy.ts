import { sha256 } from "../../lib/sha256";
import { formatUrl, hostWithPort, originOf, urlParts, webUrl } from "../../lib/urlParts";
import { isApproved, type ApprovalRule } from "./approvals";
import type { HookSpec, Rewrite } from "./hookFile";

export const SAFE_LAUNCH_ACTIONS: ReadonlySet<string> = new Set([
  "newTab",
  "newWindow",
  "newLittleArdia",
  "focusCommandBar",
  "toggleSidebar",
  "nextTab",
  "previousTab",
  "selectTab",
  "selectLastTab",
]);

const STRIPPING_TEMPLATES = new Set(["{origin}{path}", "{origin}{path}{hash}"]);

export const DOWNLOADS_FOLDER = "~/Downloads";

export const isInsideDownloads = (folder: string) => folder === DOWNLOADS_FOLDER || folder.startsWith(`${DOWNLOADS_FOLDER}/`);

export function approvalFor(hook: HookSpec): ApprovalRule | null {
  const rule = (kind: ApprovalRule["kind"], summary: string): ApprovalRule => ({ key: `${kind}:${hook.revision}`, kind, name: hook.name, summary });
  if (hook.omnibox) {
    const typed = hook.omnibox.global ? "everything you type in the address bar" : `what you type after “${hook.omnibox.keyword}”`;
    return rule("omnibox", `Sends ${typed} to ${hook.program![0]} for suggestions`);
  }
  if (!hook.decide) return null;
  if (hook.program) return rule("program", `${hook.program[0]} answers ${hook.decide}`);
  const rules = hook.rules!;
  if (rules.rewrite && !rules.rewrite.every((r) => STRIPPING_TEMPLATES.has(r.to))) {
    return rule("rewrite", rules.rewrite.map((r) => `${r.pattern} → ${r.to}`).join("; "));
  }
  if (rules.route) return rule("route", `Opens links${hook.from.length ? ` from ${hook.from.join(", ")}` : ""} in ${[rules.route.profile && `profile ${rules.route.profile}`, rules.route.open].filter(Boolean).join(", ")}`);
  if (rules.folder && !isInsideDownloads(rules.folder)) return rule("folder", `Saves downloads to ${rules.folder}`);
  return null;
}

export const isHookActive = (hook: HookSpec) => {
  const approval = approvalFor(hook);
  return !approval || isApproved(approval.key);
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function launchActionApproval(entry: string): ApprovalRule | null {
  const [id] = entry.split(":");
  if (SAFE_LAUNCH_ACTIONS.has(id!)) return null;
  return { key: `launchAction:${hex(sha256(entry)).slice(0, 32)}`, kind: "launchAction", name: `launchActions: ${entry}`, summary: `Runs ${entry} each time Ardia starts` };
}

export function applyTemplate(template: string, href: string): string | null {
  const url = urlParts(href);
  if (!url) return null;
  const parts: Record<string, string> = { url: href, origin: originOf(url), host: hostWithPort(url), path: url.path, query: url.query, hash: url.hash };
  return template.replace(/\{(url|origin|host|path|query|hash)\}/g, (_, key: string) => parts[key]!);
}

export function safeRewriteTarget(target: string | null): string | null {
  const url = target ? webUrl(target) : null;
  return url ? formatUrl(url) : null;
}

export function rewriteOf(rewrites: readonly Rewrite[], href: string, matches: (r: Rewrite) => boolean): string | null | undefined {
  const rule = rewrites.find(matches);
  if (!rule) return undefined;
  const target = safeRewriteTarget(applyTemplate(rule.to, href));
  if (target && STRIPPING_TEMPLATES.has(rule.to) && !sameOrigin(href, target)) return null;
  return target;
}

export const sameOrigin = (a: string, b: string) => {
  const x = urlParts(a);
  const y = urlParts(b);
  return !!x && !!y && originOf(x) === originOf(y);
};
