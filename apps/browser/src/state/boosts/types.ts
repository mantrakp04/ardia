export const BOOST_SIZES = [90, 100, 110, 125, 150] as const;
export type BoostSize = (typeof BOOST_SIZES)[number];

export const BOOST_CASES = ["none", "lower", "upper", "title"] as const;
export type BoostCase = (typeof BOOST_CASES)[number];

export type BoostColors = {
  hue: number;
  saturation: number;
  offset: number;
  invert: boolean;
  originalSaturation: number;
  contrast: number;
  brightness: number;
  appearance: "light" | "dark" | null;
};

export type Boost = {
  id: string;
  name: string;
  author: string;
  domain: string;
  subdomains: boolean;
  enabled: boolean;
  colors: BoostColors | null;
  font: string | null;
  size: BoostSize;
  textCase: BoostCase;
  zaps: string[];
  css: string;
  js: string;
  modified: number;
};

export const DEFAULT_COLORS: BoostColors = {
  hue: 210,
  saturation: 0.6,
  offset: 30,
  invert: false,
  originalSaturation: 0.5,
  contrast: 0.5,
  brightness: 0,
  appearance: null,
};

export const BOOST_FONTS = [
  "Helvetica Neue",
  "Avenir",
  "Futura",
  "DIN Alternate",
  "Arial Rounded MT Bold",
  "PT Mono",
  "Courier",
  "Times New Roman",
  "Charter",
  "Baskerville",
  "Hoefler Text",
  "Palatino",
  "Chalkboard",
  "SignPainter",
  "Snell Roundhand",
  "Papyrus",
  "Apple Chancery",
  "Luminari",
  "Wingdings",
  "SF Pro",
] as const;

export const MAX_ZAP_MATCHES = 100;
export const MAX_ZAP_CANDIDATES = 15;
