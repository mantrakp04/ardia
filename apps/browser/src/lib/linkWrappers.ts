type LinkWrapper = { host: RegExp; path: RegExp; params: readonly string[] };

const LINK_WRAPPERS: readonly LinkWrapper[] = [
  { host: /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/, path: /^\/url$/, params: ["q", "url"] },
  { host: /^slack-redir\.net$/, path: /^\/link$/, params: ["url"] },
  { host: /\.safelinks\.protection\.outlook\.com$/, path: /^\/?$/, params: ["url"] },
  { host: /^(l|lm)\.facebook\.com$|^l\.messenger\.com$/, path: /^\/l\.php$/, params: ["u"] },
  { host: /^l\.instagram\.com$|^l\.threads\.com$/, path: /^\/?$/, params: ["u"] },
  { host: /^(www\.|m\.)?youtube\.com$/, path: /^\/redirect$/, params: ["q"] },
  { host: /^out\.reddit\.com$/, path: /^\//, params: ["url"] },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/redir\/redirect\/?$/, params: ["url"] },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ["url", "u"] },
  { host: /^away\.vk\.com$|^vk\.com$/, path: /^\/away\.php$/, params: ["to"] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, params: ["z"] },
];

const URL_PARTS = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::\d+)?([^?#]*)(?:\?([^#]*))?/i;
const MAX_UNWRAPS = 3;

function queryParam(query: string, name: string): string | null {
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at < 0 || pair.slice(0, at) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1).replace(/\+/g, " "));
    } catch {
      return null;
    }
  }
  return null;
}

function unwrapOnce(url: string): string | null {
  const m = URL_PARTS.exec(url);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  const path = m[2] || "/";
  const wrapper = LINK_WRAPPERS.find((w) => w.host.test(host) && w.path.test(path));
  if (!wrapper) return null;
  for (const name of wrapper.params) {
    const target = queryParam(m[3] ?? "", name)?.trim();
    if (target && /^https?:\/\//i.test(target)) return target;
  }
  return null;
}

export function linkDestination(url: string): string {
  let at = url;
  for (let i = 0; i < MAX_UNWRAPS; i++) {
    const next = unwrapOnce(at);
    if (!next) break;
    at = next;
  }
  return at;
}
