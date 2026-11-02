import { hostOf } from "./frameable";

export const PAGES = {
  wikipedia: { url: "https://en.wikipedia.org/wiki/Web_browser", title: "Web browser - Wikipedia" },
  wikipediaHome: { url: "https://www.wikipedia.org/", title: "Wikipedia" },
  mdn: { url: "https://developer.mozilla.org/en-US/", title: "MDN Web Docs" },
  hackerNews: { url: "https://news.ycombinator.com/", title: "Hacker News" },
  react: { url: "https://react.dev/", title: "React" },
  xkcd: { url: "https://xkcd.com/", title: "xkcd: A webcomic of romance, sarcasm, math, and language" },
  rust: { url: "https://rust-lang.org/", title: "Rust Programming Language" },
  github: { url: "https://github.com/", title: "GitHub" },
  caniuse: { url: "https://caniuse.com/", title: "Can I use… Support tables for HTML5, CSS3, etc" },
  whatwg: { url: "https://html.spec.whatwg.org/", title: "HTML Standard" },
  vite: { url: "https://vite.dev/guide/", title: "Getting Started | Vite" },
  gutenberg: { url: "https://www.gutenberg.org/", title: "Project Gutenberg" },
} as const;

const TITLES = new Map<string, string>(Object.values(PAGES).map((p) => [p.url, p.title]));

const REMOTE_FAVICONS: Record<string, string> = {
  "en.wikipedia.org": "https://en.wikipedia.org/static/favicon/wikipedia.ico",
  "www.wikipedia.org": "https://www.wikipedia.org/static/favicon/wikipedia.ico",
  "developer.mozilla.org": "https://developer.mozilla.org/favicon.ico",
  "news.ycombinator.com": "https://news.ycombinator.com/favicon.ico",
  "react.dev": "https://react.dev/favicon-32x32.png",
  "xkcd.com": "https://xkcd.com/s/919f27.ico",
  "rust-lang.org": "https://rust-lang.org/static/images/favicon-32x32.png",
  "github.com": "https://github.com/favicon.ico",
  "caniuse.com": "https://caniuse.com/img/favicon-128.png",
  "html.spec.whatwg.org": "https://resources.whatwg.org/logo.svg",
  "www.gutenberg.org": "https://www.gutenberg.org/gutenberg/favicon.ico",
  "vite.dev": "https://vite.dev/logo-without-border.svg",
};

const LOCAL_FILES: Record<string, string> = { "html.spec.whatwg.org": "html.spec.whatwg.org.svg" };

const base = () => (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

export const FAVICON_HOSTS = Object.keys(REMOTE_FAVICONS);

export const remoteFaviconFor = (url: string) => REMOTE_FAVICONS[hostOf(url)] ?? null;

export function faviconFor(url: string) {
  const host = hostOf(url);
  if (!REMOTE_FAVICONS[host]) return null;
  return `${base()}favicons/${LOCAL_FILES[host] ?? `${host}.png`}`;
}

export function pageTitle(url: string) {
  const known = TITLES.get(url);
  if (known) return known;
  const wiki = url.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/);
  if (wiki) return `${decodeURIComponent(wiki[1]!).replace(/_/g, " ")} - Wikipedia`;
  return hostOf(url).replace(/^www\./, "") || url;
}

export type PageTheme = { color: string; source: "meta" | "header" | "background" };

export const PAGE_THEMES: Record<string, { light: PageTheme; dark: PageTheme }> = {
  "https://www.wikipedia.org/": { light: { color: "#FFFFFF", source: "background" }, dark: { color: "#101418", source: "background" } },
  "https://developer.mozilla.org/en-US/": { light: { color: "#18191B", source: "header" }, dark: { color: "#18191B", source: "header" } },
  "https://github.com/": { light: { color: "#1E2327", source: "meta" }, dark: { color: "#1E2327", source: "meta" } },
  "https://en.wikipedia.org/wiki/Web_browser": { light: { color: "#FFFFFF", source: "header" }, dark: { color: "#FFFFFF", source: "header" } },
  "https://news.ycombinator.com/": { light: { color: "#FFFFFF", source: "background" }, dark: { color: "#FFFFFF", source: "background" } },
  "https://react.dev/": { light: { color: "#23272F", source: "meta" }, dark: { color: "#23272F", source: "meta" } },
  "https://xkcd.com/": { light: { color: "#96A8C8", source: "background" }, dark: { color: "#96A8C8", source: "background" } },
  "https://rust-lang.org/": { light: { color: "#FFFFFF", source: "meta" }, dark: { color: "#FFFFFF", source: "meta" } },
  "https://caniuse.com/": { light: { color: "#3D3527", source: "background" }, dark: { color: "#17140E", source: "background" } },
  "https://html.spec.whatwg.org/": { light: { color: "#3C790A", source: "meta" }, dark: { color: "#3C790A", source: "meta" } },
  "https://vite.dev/guide/": { light: { color: "#646CFF", source: "meta" }, dark: { color: "#646CFF", source: "meta" } },
  "https://www.gutenberg.org/": { light: { color: "#7EBED0", source: "header" }, dark: { color: "#7EBED0", source: "header" } },
};
