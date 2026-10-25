import { displayHost } from "@ardia/core";

const ORIGIN_PARTS = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?/i;
const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };

export function originForDisplay(origin: string): string {
  const parts = ORIGIN_PARTS.exec(origin.trim());
  if (!parts?.[2]) return origin;
  const scheme = parts[1]!.toLowerCase();
  const port = Number(parts[3] ?? 0);
  const host = displayHost(parts[2].toLowerCase()) + (port && port !== DEFAULT_PORTS[scheme] ? `:${port}` : "");
  return scheme === "https" ? host : `${scheme}://${host}`;
}
