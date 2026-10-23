import type { BrowserState } from "./browser";
import { engineProfile } from "./model";
import type { LinkRule } from "./settings";

export type LinkRuleTarget = { host: string; path: string };
export type SavedLinkRule = LinkRuleTarget & { profile: string };

const SCHEME = /^[a-z][\w+.-]*:\/\//i;
const WEB_URL = /^https?:\/\/(?:[^@/?#]*@)?([^/:?#]*)(?::\d*)?([^?#]*)/i;

export function linkRuleTarget(pattern: string): LinkRuleTarget | null {
  const text = pattern.trim().toLowerCase().replace(SCHEME, "").replace(/[?#].*$/, "");
  const slash = text.indexOf("/");
  const host = (slash < 0 ? text : text.slice(0, slash)).replace(/^\*\./, "").replace(/^www\./, "").replace(/:\d*$/, "").replace(/\.$/, "");
  const path = slash < 0 ? "" : text.slice(slash).replace(/\/+$/, "");
  if (!host || /[\s*]/.test(host) || /\s/.test(path)) return null;
  return { host, path };
}

export function linkRuleMatches(target: LinkRuleTarget, url: string): boolean {
  const parts = url.match(WEB_URL);
  if (!parts) return false;
  const host = parts[1]!.toLowerCase().replace(/\.$/, "");
  const path = parts[2]!.toLowerCase();
  if (host !== target.host && !host.endsWith(`.${target.host}`)) return false;
  return !target.path || path === target.path || path.startsWith(`${target.path}/`);
}

const usableRules = (s: Pick<BrowserState, "settings" | "profiles">): { rule: LinkRule; target: LinkRuleTarget }[] =>
  (s.settings.linkRules ?? []).flatMap((rule) => {
    const target = s.profiles[rule.profileId] ? linkRuleTarget(rule.pattern) : null;
    return target ? [{ rule, target }] : [];
  });

export function linkRuleProfile(s: Pick<BrowserState, "settings" | "profiles">, url: string): string | null {
  return usableRules(s).find(({ target }) => linkRuleMatches(target, url))?.rule.profileId ?? null;
}

export const savedLinkRules = (s: Pick<BrowserState, "settings" | "profiles">): SavedLinkRule[] =>
  usableRules(s).map(({ rule, target }) => ({ ...target, profile: engineProfile(rule.profileId) }));
