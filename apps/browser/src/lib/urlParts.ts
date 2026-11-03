export type UrlParts = {
  scheme: string;
  username: string;
  password: string;
  host: string;
  port: string;
  path: string;
  query: string;
  hash: string;
  authority: boolean;
};

const SHAPE = /^([a-zA-Z][a-zA-Z\d+.-]*):(\/\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?(\[[^\]/?#]*\]|[^:/?#]*)(?::(\d*))?)?([^?#]*)(\?[^#]*)?(#.*)?$/;
const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443", ftp: "21" };
const HOST = /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])$/;

export function urlParts(href: string): UrlParts | null {
  if (typeof href !== "string" || /[\u0000- \u007f]/.test(href)) return null;
  const found = SHAPE.exec(href);
  if (!found) return null;
  const scheme = found[1]!.toLowerCase();
  const authority = found[2] !== undefined;
  const host = (found[5] ?? "").toLowerCase();
  const web = scheme === "http" || scheme === "https";
  if (web && (!authority || !host)) return null;
  if (host && !HOST.test(host)) return null;
  const port = found[6] ?? "";
  if (port && Number(port) > 65535) return null;
  const path = found[7] || (authority ? "/" : "");
  return { scheme, username: found[3] ?? "", password: found[4] ?? "", host, port: port === DEFAULT_PORTS[scheme] ? "" : port, path, query: found[8] ?? "", hash: found[9] ?? "", authority };
}

export const effectivePort = (parts: UrlParts) => parts.port || DEFAULT_PORTS[parts.scheme] || "-1";

export const hostWithPort = (parts: UrlParts) => (parts.port ? `${parts.host}:${parts.port}` : parts.host);

export const originOf = (parts: UrlParts) => `${parts.scheme}://${hostWithPort(parts)}`;

export const formatUrl = (parts: UrlParts) =>
  `${parts.authority ? originOf(parts) : `${parts.scheme}:`}${parts.path}${parts.query}${parts.hash}`;

export function webUrl(href: string): UrlParts | null {
  const parts = urlParts(href);
  if (!parts || (parts.scheme !== "http" && parts.scheme !== "https") || parts.username || parts.password) return null;
  return parts;
}
