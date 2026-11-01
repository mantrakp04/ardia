export type SiteSearch = { host: string; name: string; url: string; keyword?: string; aliases?: string[]; enabled?: boolean; action?: "ask" };
export type SiteSearchOverride = { name: string; keyword: string; aliases: string[]; url: string; enabled: boolean };

export const SITE_SEARCH_PRESETS: readonly SiteSearch[] = [
  { host: "docs.google.com", name: "Google Docs", keyword: "docs", url: "https://docs.google.com/document/u/0/?q=%s" },
  { host: "sheets.google.com", name: "Google Sheets", keyword: "sheets", url: "https://docs.google.com/spreadsheets/u/0/?q=%s" },
  { host: "slides.google.com", name: "Google Slides", keyword: "slides", url: "https://docs.google.com/presentation/u/0/?q=%s" },
  { host: "chatgpt.com", name: "ChatGPT", keyword: "chatgpt", action: "ask", url: "https://chatgpt.com/?q=%s" },
  { host: "claude.ai", name: "Claude", keyword: "claude", action: "ask", url: "https://claude.ai/new?q=%s" },
  { host: "youtube.com", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { host: "wikipedia.org", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  { host: "github.com", name: "GitHub", keyword: "github", aliases: ["gh"], url: "https://github.com/search?q=%s" },
  { host: "amazon.com", name: "Amazon", url: "https://www.amazon.com/s?k=%s" },
  { host: "reddit.com", name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  { host: "x.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "twitter.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "stackoverflow.com", name: "Stack Overflow", url: "https://stackoverflow.com/search?q=%s" },
  { host: "npmjs.com", name: "npm", url: "https://www.npmjs.com/search?q=%s" },
  { host: "maps.google.com", name: "Google Maps", keyword: "maps", url: "https://www.google.com/maps/search/%s" },
  { host: "drive.google.com", name: "Google Drive", keyword: "drive", url: "https://drive.google.com/drive/search?q=%s" },
  { host: "mail.google.com", name: "Gmail", keyword: "gmail", aliases: ["mail"], url: "https://mail.google.com/mail/u/0/#search/%s" },
  { host: "imdb.com", name: "IMDb", url: "https://www.imdb.com/find/?q=%s" },
  { host: "open.spotify.com", keyword: "spotify", name: "Spotify", url: "https://open.spotify.com/search/%s" },
  { host: "linkedin.com", name: "LinkedIn", url: "https://www.linkedin.com/search/results/all/?keywords=%s" },
  { host: "ebay.com", name: "eBay", url: "https://www.ebay.com/sch/i.html?_nkw=%s" },
  { host: "pinterest.com", name: "Pinterest", url: "https://www.pinterest.com/search/pins/?q=%s" },
  { host: "news.ycombinator.com", keyword: "hn", name: "Hacker News", url: "https://hn.algolia.com/?q=%s" },
  { host: "developer.mozilla.org", keyword: "mdn", name: "MDN", url: "https://developer.mozilla.org/en-US/search?q=%s" },
  { host: "figma.com", name: "Figma", url: "https://www.figma.com/files/search?q=%s" },
  { host: "notion.so", name: "Notion", url: "https://www.notion.so/search?q=%s" },
  { host: "apps.apple.com", keyword: "appstore", name: "App Store", url: "https://apps.apple.com/us/mac/search?term=%s" },
  { host: "translate.google.com", keyword: "translate", name: "Google Translate", url: "https://translate.google.com/?text=%s" },
];

export function normalizeSearchKeyword(text: string): string {
  return text.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export function validSearchKeyword(text: string): boolean {
  const keyword = normalizeSearchKeyword(text);
  return !!keyword && !/[\s/?#]/.test(keyword);
}

export function siteSearches(overrides: Record<string, SiteSearchOverride> = {}): SiteSearch[] {
  return SITE_SEARCH_PRESETS.map((site) => ({ ...site, ...overrides[site.host], host: site.host, action: site.action }));
}

export function siteKeywords(site: SiteSearch): string[] {
  const keyword = site.keyword ?? site.host.split(".").at(-2) ?? site.host;
  return [keyword, ...(site.aliases ?? [])];
}

export function validSearchTemplate(url: string): boolean {
  if (!url.includes("%s")) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.host.includes("%s") && !/\s/.test(url);
  } catch {
    return false;
  }
}

export function validSiteSearchOverride(value: unknown): value is SiteSearchOverride {
  if (!value || typeof value !== "object") return false;
  const v = value as SiteSearchOverride;
  return typeof v.name === "string" && !!v.name.trim() && typeof v.keyword === "string" && validSearchKeyword(v.keyword) &&
    !/\s/.test(v.keyword) && Array.isArray(v.aliases) && v.aliases.every((a) => typeof a === "string" && validSearchKeyword(a) && !/\s/.test(a)) &&
    typeof v.url === "string" && validSearchTemplate(v.url) && typeof v.enabled === "boolean";
}
