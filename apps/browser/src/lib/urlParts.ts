import { hostSpoofReason, punycodeEncode } from "@ardia/core";

export type UrlParts = {
  scheme: string;
  host: string;
  port: string;
  path: string;
  query: string;
  hash: string;
  authority: boolean;
};

const SHAPE = /^([a-zA-Z][a-zA-Z\d+.-]*):(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/;
const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443", ftp: "21" };
const NAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?$/;
const DOTTED = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const NUMERIC_LABEL = /^(0x[0-9a-f]*|\d+)$/;

export function canonicalIpv6(text: string): string | null {
  if (!/^[0-9a-f:]+$/.test(text) || (text.match(/::/g) ?? []).length > 1) return null;
  const compressed = text.includes("::");
  const [head, tail] = compressed ? text.split("::") : [text, ""];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (compressed ? missing < 1 : left.length !== 8) return null;
  const groups = [...left, ...Array<string>(compressed ? missing : 0).fill("0"), ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const values = groups.map((g) => parseInt(g, 16).toString(16));
  let best = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    if (values[i] !== "0") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && values[j] === "0") j += 1;
    if (j - i > bestLength) [best, bestLength] = [i, j - i];
    i = j;
  }
  if (best < 0) return values.join(":");
  return `${values.slice(0, best).join(":")}::${values.slice(best + bestLength).join(":")}`;
}

const DEVIATIONS = /[\u00df\u03c2\u200c\u200d\u3002\uff0e\uff61]/;
const UNICODE_LABEL = /^[\p{L}\p{M}\p{N}-]{1,63}$/u;

export function asciiHost(host: string): string | null {
  if (/^[\x00-\x7f]*$/.test(host)) return host;
  const lower = host.normalize("NFC").toLowerCase();
  if (DEVIATIONS.test(lower) || lower.normalize("NFKC") !== lower) return null;
  const labels = lower.split(".").map((label) => {
    if (/^[\x00-\x7f]*$/.test(label)) return label;
    if (!UNICODE_LABEL.test(label) || label.startsWith("-") || label.endsWith("-")) return null;
    const encoded = `xn--${punycodeEncode(label)}`;
    return encoded.length <= 63 ? encoded : null;
  });
  if (labels.some((label) => label === null)) return null;
  const ascii = labels.join(".");
  return hostSpoofReason(ascii) ? null : ascii;
}

function plainHost(given: string): string | null {
  const raw = given.startsWith("[") ? given : asciiHost(given);
  if (raw === null) return null;
  if (raw.startsWith("[")) {
    if (!raw.endsWith("]")) return null;
    const inner = raw.slice(1, -1);
    return canonicalIpv6(inner) === inner ? raw : null;
  }
  const host = raw.toLowerCase();
  if (!NAME.test(host)) return null;
  const labels = host.replace(/\.$/, "").split(".");
  if (NUMERIC_LABEL.test(labels[labels.length - 1]!)) return DOTTED.test(host) ? host : null;
  return host;
}

export function urlParts(href: string): UrlParts | null {
  if (typeof href !== "string" || /[\u0000- \u007f\\]/.test(href)) return null;
  const found = SHAPE.exec(href);
  if (!found) return null;
  const scheme = found[1]!.toLowerCase();
  const authority = found[2] !== undefined;
  const web = scheme === "http" || scheme === "https";
  let host = "";
  let port = "";
  if (authority) {
    const hostAndPort = found[3]!;
    if (hostAndPort.includes("@") || hostAndPort.includes("%")) return null;
    const colon = hostAndPort.startsWith("[") ? hostAndPort.indexOf(":", hostAndPort.indexOf("]")) : hostAndPort.indexOf(":");
    const rawHost = colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
    if (colon >= 0) {
      port = hostAndPort.slice(colon + 1);
      if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) return null;
      if (port === DEFAULT_PORTS[scheme]) port = "";
    }
    if (rawHost) {
      const plain = plainHost(rawHost);
      if (!plain) return null;
      host = plain;
    }
  }
  if (web && (!authority || !host)) return null;
  const path = found[4] || (authority ? "/" : "");
  return { scheme, host, port, path, query: found[5] ?? "", hash: found[6] ?? "", authority };
}

export const effectivePort = (parts: UrlParts) => parts.port || DEFAULT_PORTS[parts.scheme] || "-1";

export const hostWithPort = (parts: UrlParts) => (parts.port ? `${parts.host}:${parts.port}` : parts.host);

export const originOf = (parts: UrlParts) => `${parts.scheme}://${hostWithPort(parts)}`;

export const formatUrl = (parts: UrlParts) => `${parts.authority ? originOf(parts) : `${parts.scheme}:`}${parts.path}${parts.query}${parts.hash}`;

export function webUrl(href: string): UrlParts | null {
  const parts = urlParts(href);
  return parts && (parts.scheme === "http" || parts.scheme === "https") ? parts : null;
}

export function minimizedUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}
