export const FRAMEABLE_HOSTS = [
  "en.wikipedia.org",
  "www.wikipedia.org",
  "en.wiktionary.org",
  "commons.wikimedia.org",
  "example.com",
  "react.dev",
  "vite.dev",
  "nodejs.org",
  "rust-lang.org",
  "www.typescriptlang.org",
  "docs.python.org",
  "tc39.es",
  "html.spec.whatwg.org",
  "caniuse.com",
  "xkcd.com",
  "info.cern.ch",
  "sqlite.org",
  "archive.org",
  "openlibrary.org",
  "www.gutenberg.org",
  "lobste.rs",
  "excalidraw.com",
  "www.tldraw.com",
  "ardia.dev",
  "www.weather.gov",
] as const;

const allowed = new Set<string>(FRAMEABLE_HOSTS);

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const isFrameable = (url: string) => /^https:\/\//i.test(url) && allowed.has(hostOf(url));
