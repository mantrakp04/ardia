export const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const homeUrl = (site: URL | undefined) => new URL(`${base}/`, site).href;

export const PAGES = {
  home: "",
  try: "try/",
  arc: "arc/",
  benchmarks: "benchmarks/",
  notes: "release-notes/",
  press: "press/",
  privacy: "privacy/",
  terms: "terms/",
} as const;
export const pagePath = (page: keyof typeof PAGES) => `${base}/${PAGES[page]}`;
