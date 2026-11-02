import type { Boost } from "./types";

const bareHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

export const boostDomain = (host: string) => bareHost(host);

export function boostMatchesHost(boost: Pick<Boost, "domain" | "subdomains">, host: string): boolean {
  const domain = bareHost(boost.domain);
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || !h) return false;
  if (h === domain || h === `www.${domain}`) return true;
  return boost.subdomains && h.endsWith(`.${domain}`);
}

export function boostsForHost<T extends Pick<Boost, "domain" | "subdomains" | "enabled">>(boosts: readonly T[], host: string): T[] {
  return boosts.filter((boost) => boost.enabled && boostMatchesHost(boost, host));
}
