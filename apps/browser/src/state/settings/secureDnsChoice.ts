import type { SecureDnsProvider, SecureDnsState } from "../../platform/secureDns";

export type SecureDnsChoice =
  | { kind: "off" }
  | { kind: "network" }
  | { kind: "provider"; provider: SecureDnsProvider }
  | { kind: "custom"; templates: string; fallback: boolean };

export function secureDnsChoice(state: Pick<SecureDnsState, "prefMode" | "prefTemplates" | "providers">): SecureDnsChoice {
  const { prefMode, prefTemplates } = state;
  if (prefMode === "automatic") return prefTemplates ? { kind: "custom", templates: prefTemplates, fallback: true } : { kind: "network" };
  if (prefMode !== "secure") return { kind: "off" };
  const provider = state.providers.find((p) => p.templates === prefTemplates);
  return provider ? { kind: "provider", provider } : { kind: "custom", templates: prefTemplates, fallback: false };
}

export const secureDnsLocked = (state: Pick<SecureDnsState, "policy" | "override">) => state.policy || state.override !== "none";

function templateList(templates: string): string[] {
  try {
    const parsed: unknown = JSON.parse(templates);
    const servers = (parsed as { servers?: unknown })?.servers;
    if (Array.isArray(servers)) return servers.flatMap((s) => (typeof s?.template === "string" ? [s.template] : []));
  } catch {}
  return templates.split(/\s+/).filter(Boolean);
}

export function secureDnsEditableTemplates(templates: string): string {
  try {
    return JSON.stringify(JSON.parse(templates));
  } catch {
    return templates.trim().split(/\s+/).join(" ");
  }
}

export function secureDnsHosts(templates: string): string {
  const hosts = templateList(templates).map((t) => /^https:\/\/([^/?{#]+)/i.exec(t)?.[1]?.toLowerCase() ?? t);
  return [...new Set(hosts)].join(", ");
}
