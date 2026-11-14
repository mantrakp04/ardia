import { effectivePort, urlParts } from "./urlParts";

export type MatchSpec = { all: boolean; schemes: string[]; host: string; sub: boolean; port: string; file: boolean; path: string };

const SCRIPT_SCHEMES = ["http", "https", "file", "ftp"];
const WILDCARD_SCHEMES = ["http", "https"];

function checkPort(scheme: string, port: string): string | null {
  if (port === "*") return null;
  if (scheme === "*") return "a pattern with scheme * can't name a port";
  if (!/^\d+$/.test(port)) return "the port is a number or *";
  if (port.length > 1 && port.startsWith("0")) return "write the port without leading zeros";
  if (Number(port) > 65535) return "the port must be 0 to 65535";
  return null;
}

export function parseMatchPattern(pattern: string): MatchSpec | { error: string } {
  if (pattern === "<all_urls>") return { all: true, schemes: SCRIPT_SCHEMES, host: "", sub: true, port: "*", file: false, path: "/*" };
  if (pattern.includes("\0")) return { error: "contains a null character" };
  const sep = pattern.indexOf("://");
  if (sep < 0) return { error: "a match pattern is <all_urls> or scheme://host/path" };
  const scheme = pattern.slice(0, sep);
  const rest = pattern.slice(sep + 3);
  if (scheme !== "*" && !SCRIPT_SCHEMES.includes(scheme)) return { error: `match patterns only match ${["*", ...SCRIPT_SCHEMES].join(", ")} URLs` };
  const schemes = scheme === "*" ? WILDCARD_SCHEMES : [scheme];
  if (!rest) return { error: "the host is empty" };
  if (scheme === "file") {
    const slash = rest.indexOf("/");
    if (slash < 0) return { error: "add a path, like file:///*" };
    const host = rest.slice(0, slash);
    if (host && host !== "localhost") return { error: "file patterns have no host (file:///path)" };
    return { all: false, schemes, host: "", sub: false, port: "*", file: true, path: rest.slice(slash) };
  }
  const end = rest.indexOf("/");
  if (end === 0) return { error: "the host is empty" };
  if (end < 0) return { error: "add a path, like /*" };
  const hostAndPort = rest.slice(0, end);
  const colon = hostAndPort.startsWith("[") ? hostAndPort.indexOf(":", hostAndPort.indexOf("]")) : hostAndPort.indexOf(":");
  let host = colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
  const port = colon < 0 ? "*" : hostAndPort.slice(colon + 1);
  const portProblem = checkPort(scheme, port);
  if (portProblem) return { error: portProblem };
  if (!host) return { error: "the host is empty" };
  let sub = false;
  if (host === "*") [sub, host] = [true, ""];
  else if (host.startsWith("*.")) {
    if (host.length === 2) return { error: "the host is empty" };
    [sub, host] = [true, host.slice(2)];
  }
  if (host.includes("*")) return { error: "* only works as the whole host or a *. prefix" };
  if (host.includes("%")) return { error: "hosts can't have %" };
  if (host && !host.startsWith("[")) {
    const parsed = urlParts(`http://${host}/`);
    if (!parsed) return { error: "the host has characters a hostname can't have" };
    host = parsed.host;
  }
  return { all: false, schemes, host: host.toLowerCase(), sub, port, file: false, path: rest.slice(end) };
}

function globMatches(glob: string, text: string): boolean {
  let g = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (g < glob.length && glob[g] !== "*" && glob[g] === text[t]) {
      g += 1;
      t += 1;
    } else if (g < glob.length && glob[g] === "*") {
      star = g++;
      resume = t;
    } else if (star >= 0) {
      g = star + 1;
      t = ++resume;
    } else return false;
  }
  while (glob[g] === "*") g += 1;
  return g === glob.length;
}

const isIp = (host: string) => host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);

function hostMatches(spec: MatchSpec, given: string): boolean {
  const host = given.replace(/\.+$/, "");
  const pattern = spec.host.replace(/\.+$/, "");
  if (host === pattern) return true;
  if (spec.sub && !pattern) return true;
  if (!spec.sub || isIp(host)) return false;
  return host.length > pattern.length + 1 && host.endsWith(`.${pattern}`);
}

export function matchesUrl(spec: MatchSpec, href: string): boolean {
  const url = urlParts(href);
  if (!url || !spec.schemes.includes(url.scheme)) return false;
  if (spec.all) return true;
  if (!spec.file && !hostMatches(spec, url.host)) return false;
  if (spec.port !== "*" && spec.port !== effectivePort(url)) return false;
  const path = url.path + url.query;
  if (spec.path === `${path}/*`) return true;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {}
  return globMatches(spec.path, path) || globMatches(spec.path, decoded);
}

export const anyMatches = (specs: readonly MatchSpec[], href: string) => specs.some((spec) => matchesUrl(spec, href));
