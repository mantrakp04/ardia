export type LinkDestination = { kind: "little" } | { kind: "recent" } | { kind: "profile"; profileId: string };

export type LinkRule = {
  id: string;
  match: "contains" | "equals";
  text: string;
  destination: LinkDestination;
};

export type LinkRouting = {
  rules: LinkRule[];
  defaultDestination: LinkDestination;
};

export const LITTLE_DESTINATION: LinkDestination = { kind: "little" };
export const RECENT_DESTINATION: LinkDestination = { kind: "recent" };

export const DEFAULT_LINK_ROUTING: LinkRouting = { rules: [], defaultDestination: LITTLE_DESTINATION };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function destinationOf(value: unknown): LinkDestination | null {
  if (!isRecord(value)) return null;
  if (value.kind === "little") return LITTLE_DESTINATION;
  if (value.kind === "recent") return RECENT_DESTINATION;
  if (value.kind === "profile" && typeof value.profileId === "string" && value.profileId) return { kind: "profile", profileId: value.profileId };
  return null;
}

function ruleOf(value: unknown): LinkRule | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.text !== "string") return null;
  if (value.match !== "contains" && value.match !== "equals") return null;
  const destination = destinationOf(value.destination);
  return destination ? { id: value.id, match: value.match, text: value.text, destination } : null;
}

export function normalizeLinkRouting(value: unknown): LinkRouting {
  if (!isRecord(value)) return DEFAULT_LINK_ROUTING;
  const seen = new Set<string>();
  const rules = (Array.isArray(value.rules) ? value.rules : []).map(ruleOf).filter((rule): rule is LinkRule => {
    if (!rule || seen.has(rule.id)) return false;
    seen.add(rule.id);
    return true;
  });
  return { rules, defaultDestination: destinationOf(value.defaultDestination) ?? LITTLE_DESTINATION };
}

export const sameDestination = (a: LinkDestination, b: LinkDestination) =>
  a.kind === b.kind && (a.kind !== "profile" || (b.kind === "profile" && a.profileId === b.profileId));

let ruleCounter = 0;
export const newLinkRuleId = () => `route-${Date.now().toString(36)}-${(++ruleCounter).toString(36)}`;

export const withLinkRule = (routing: LinkRouting, rule: LinkRule): LinkRouting => ({ ...routing, rules: [...routing.rules, rule] });

export const withLinkRuleChanged = (routing: LinkRouting, id: string, patch: Partial<Omit<LinkRule, "id">>): LinkRouting => ({
  ...routing,
  rules: routing.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
});

export const withoutLinkRule = (routing: LinkRouting, id: string): LinkRouting => ({ ...routing, rules: routing.rules.filter((rule) => rule.id !== id) });

export const withDefaultDestination = (routing: LinkRouting, defaultDestination: LinkDestination): LinkRouting => ({ ...routing, defaultDestination });

export const opensExternalLinksInLittle = (routing: LinkRouting) => routing.defaultDestination.kind === "little";
