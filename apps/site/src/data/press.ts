import { DISCORD, MIN_MACOS, REPO } from "./release";

export const SITE = "ardia.dev";
export const FIRST_RELEASE = "25 September 2026";
export const MAKER = "Mantra Patel";

export const SHORT =
  "Ardia is a free, open-source Mac browser with Arc’s sidebar and Dia’s polish, built on Chromium.";
export const LONG = `Ardia is a web browser for the Mac with Arc’s sidebar and Dia’s polish, built on Chromium and Chrome’s own framework, so sites, extensions and DevTools behave as they do in Chrome. The full uBlock Origin is built in, so ads, trackers and cookie banners stay out, and Google’s background services are compiled out. Profiles keep work and home apart, and Sync runs end to end encrypted through the user’s own iCloud Drive. Ardia is free and open source under the GPL-3.0, notarized by Apple, and runs on Apple Silicon Macs with ${MIN_MACOS} or later. The first public build shipped on ${FIRST_RELEASE}.`;

export const FACTS: { term: string; value: string; href?: string }[] = [
  { term: "Name", value: "Ardia" },
  { term: "What", value: "A web browser for the Mac" },
  { term: "Engine", value: "Chromium, on Chrome’s own framework" },
  { term: "Runs on", value: `Apple Silicon, ${MIN_MACOS} or later` },
  { term: "Price", value: "Free" },
  { term: "Licence", value: "GPL-3.0 (Ardia’s own code: Apache-2.0)" },
  { term: "First release", value: FIRST_RELEASE },
  { term: "Made by", value: MAKER },
  { term: "Website", value: SITE, href: `https://${SITE}` },
  { term: "Source", value: REPO.replace("https://", ""), href: REPO },
  { term: "Community", value: "Discord", href: DISCORD },
];

export const COLOURS: { name: string; hex: string; use: string }[] = [
  { name: "Sun", hex: "#E6BC62", use: "The logo’s sun." },
  { name: "Sage", hex: "#71955A", use: "The hill at the back." },
  { name: "Forest", hex: "#203F32", use: "The hill in front." },
  { name: "Parchment", hex: "#F9F5E3", use: "The app icon’s tile." },
  { name: "Paper", hex: "#F1ECE2", use: "The site’s background." },
  { name: "Ink", hex: "#16130F", use: "Text on the site." },
];

export const FONTS = [
  {
    name: "Mona Sans",
    by: "GitHub",
    use: "Headlines, squeezed and heavy, and body text.",
    href: "https://github.com/github/mona-sans",
    family: "var(--poster)",
  },
  {
    name: "Martian Mono",
    by: "Evil Martians",
    use: "Labels and small print, in capitals.",
    href: "https://github.com/evilmartians/mono",
    family: "var(--mono)",
  },
];

export type Format = "svg" | "png";
export interface Logo {
  id: string;
  title: string;
  use: string;
  ground: "light" | "night";
  formats: Format[];
}

export const LOGOS: Logo[] = [
  { id: "app-icon", title: "App icon", use: "The one to use. The painted tile, as it sits in the Dock.", ground: "light", formats: ["png"] },
  { id: "mark-painted", title: "Painted mark", use: "The hills without the tile, for when the logo stands on its own.", ground: "light", formats: ["png"] },
  { id: "mark-colour", title: "Flat mark", use: "Three flat colours, for small sizes and print.", ground: "light", formats: ["svg", "png"] },
  { id: "mark-black", title: "One colour, black", use: "On light backgrounds.", ground: "light", formats: ["svg", "png"] },
  { id: "mark-white", title: "One colour, white", use: "On dark backgrounds and photos.", ground: "night", formats: ["svg", "png"] },
];

export const SHOTS: { id: string; title: string }[] = [
  { id: "window", title: "The window" },
  { id: "split", title: "Split view" },
  { id: "tab-group", title: "Tab groups" },
  { id: "pip", title: "The mini player" },
  { id: "address-sidebar", title: "Address bar in the sidebar" },
  { id: "little-ardia", title: "Little Ardia" },
  { id: "extensions", title: "Chrome Web Store" },
  { id: "privacy", title: "Privacy settings" },
];

export const colour = (name: string) => COLOURS.find((c) => c.name === name)!.hex;

export const logoFile = (id: string, format: Format) => `ardia-${id}.${format}`;
export const shotFile = (id: string) => `ardia-screenshot-${id}.jpg`;
export const ZIP_NAME = "ardia-press-kit.zip";

export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

