import type { Family } from "./model";

export type Root = "local" | "roaming";

export type Browser = {
  id: string;
  name: string;
  family: Family;
  root: Root;
  path: string;
  rootIsProfile?: boolean;
  sidebar?: "arc" | "zen";
};

const chromium = (id: string, name: string, path: string, root: Root = "local", rootIsProfile = false): Browser => ({
  id,
  name,
  family: "chromium",
  root,
  path,
  rootIsProfile,
});

const ARC_PACKAGE = "Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc\\User Data";

export const BROWSERS: Browser[] = [
  chromium("chrome", "Google Chrome", "Google\\Chrome\\User Data"),
  chromium("edge", "Microsoft Edge", "Microsoft\\Edge\\User Data"),
  { id: "arc", name: "Arc", family: "arc", root: "local", path: ARC_PACKAGE, sidebar: "arc" },
  { id: "firefox", name: "Firefox", family: "firefox", root: "roaming", path: "Mozilla\\Firefox" },
  { id: "zen", name: "Zen", family: "firefox", root: "roaming", path: "zen", sidebar: "zen" },
  chromium("brave", "Brave", "BraveSoftware\\Brave-Browser\\User Data"),
  chromium("vivaldi", "Vivaldi", "Vivaldi\\User Data"),
  chromium("opera", "Opera", "Opera Software\\Opera Stable", "roaming", true),
  chromium("operaGX", "Opera GX", "Opera Software\\Opera GX Stable", "roaming", true),
  chromium("chromium", "Chromium", "Chromium\\User Data"),
  chromium("chromeBeta", "Google Chrome Beta", "Google\\Chrome Beta\\User Data"),
  chromium("chromeDev", "Google Chrome Dev", "Google\\Chrome Dev\\User Data"),
  chromium("chromeCanary", "Google Chrome Canary", "Google\\Chrome SxS\\User Data"),
  chromium("edgeBeta", "Microsoft Edge Beta", "Microsoft\\Edge Beta\\User Data"),
  chromium("edgeDev", "Microsoft Edge Dev", "Microsoft\\Edge Dev\\User Data"),
  chromium("edgeCanary", "Microsoft Edge Canary", "Microsoft\\Edge SxS\\User Data"),
  chromium("braveBeta", "Brave Beta", "BraveSoftware\\Brave-Browser-Beta\\User Data"),
  chromium("braveNightly", "Brave Nightly", "BraveSoftware\\Brave-Browser-Nightly\\User Data"),
];

export const findBrowser = (id: string) => BROWSERS.find((b) => b.id === id);

export const isChromiumBased = (b: Browser) => b.family === "chromium" || b.family === "arc";
