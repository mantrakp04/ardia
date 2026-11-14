import { isFields } from "./decode";
import type { JsonSchema } from "./jsonSchema";
import { DEFAULT_SIDEBAR_WIDTH } from "./windowLayout";

export const TYPE_SIZES = { badge: 9, tiny: 10, caption: 11, small: 12, body: 13, title: 15, large: 17 } as const;
export const WEIGHTS = { regular: "400", medium: "500", semibold: "600", bold: "700" } as const;
export const RADII = { none: 0, hair: 2, control: 4, tile: 8, panel: 12, sheet: 16, hero: 20, chrome: 10, toolbar: 7, pinned: 10 } as const;
export const ROW_METRICS = { rowHeight: 34, rowGap: 3, pinnedHeight: 41 } as const;
export const MONO_FAMILY = "Menlo";

export type TypeSizeName = keyof typeof TYPE_SIZES;
export type WeightName = keyof typeof WEIGHTS;
export type FontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";
export type RadiusName = keyof typeof RADII;
export type RowMetrics = { -readonly [K in keyof typeof ROW_METRICS]: number };

export const CHROME_PARTS = ["pinned", "newTab", "addressField", "navButtons", "sidebarButton", "downloads", "profile"] as const;
export type ChromePart = (typeof CHROME_PARTS)[number];
export const PLACES = ["top", "bottom"] as const;
export type Place = (typeof PLACES)[number];

export const THEME_RADII = { row: "chrome", pinned: "pinned", tile: "tile", control: "control", toolbar: "toolbar", panel: "panel", sheet: "sheet" } as const satisfies Record<string, RadiusName>;
type ThemeRadius = keyof typeof THEME_RADII;

export type ThemeLook = {
  readonly family: string | null;
  readonly mono: string;
  readonly sizes: Readonly<Record<TypeSizeName, number>>;
  readonly weights: Readonly<Record<WeightName, FontWeight>>;
  readonly metrics: Readonly<RowMetrics>;
  readonly sidebarWidth: number | null;
  readonly radii: Readonly<Record<RadiusName, number>>;
  readonly hidden: ReadonlySet<ChromePart>;
  readonly addressField: Place;
  readonly newTab: Place | null;
  readonly icons: ReadonlyMap<string, string>;
};

export type LookBlocks = { type?: Fields; metrics?: Fields; layout?: Fields; icons?: Record<string, string> };
type Fields = { [key: string]: unknown };

const FONT_WEIGHTS: readonly FontWeight[] = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
export const SYMBOL_PATTERN = "^[a-z0-9]+(\\.[a-z0-9]+)*$";
const SYMBOL = new RegExp(SYMBOL_PATTERN);
export const FAMILY_PATTERN = "^\\S(.{0,62}\\S)?$";
const FAMILY = new RegExp(FAMILY_PATTERN);

type Spec =
  | { kind: "number"; min: number; max: number; default: number | null; about: string }
  | { kind: "family"; default: string | null; about: string }
  | { kind: "weight"; default: FontWeight; about: string }
  | { kind: "place"; default: Place | null; about: string }
  | { kind: "parts"; about: string }
  | { kind: "symbols"; about: string }
  | { kind: "block"; noun: string; keys: Record<string, Spec>; about: string };

const number = (min: number, max: number, value: number | null, about: string): Spec => ({ kind: "number", min, max, default: value, about });
const sizeRange = (size: number, about: string) => number(Math.round(size * 0.75), Math.round(size * 1.6), size, about);

const SIZE_ABOUT: Record<TypeSizeName, string> = {
  badge: "Counts on badges",
  tiny: "The smallest labels",
  caption: "Captions, section labels, URLs under titles",
  small: "Sidebar tab titles, secondary text",
  body: "Most text: menus, fields, folder and group names",
  title: "Panel and dialog titles, the command bar's results",
  large: "Large headings, the command bar's field",
};

const WEIGHT_ABOUT: Record<WeightName, string> = {
  regular: "What regular text draws with",
  medium: "What medium text (group names, selected rows) draws with",
  semibold: "What semibold text (headings, badges) draws with",
  bold: "What bold text draws with",
};

const RADIUS_ABOUT: Record<ThemeRadius, string> = {
  row: "Sidebar rows (tabs, folders, New Tab), the sidebar address field, top-strip tabs",
  pinned: "Pinned tiles in the sidebar's top apps grid",
  tile: "List rows, menu rows, fields, cards and icon tiles",
  control: "Small controls: steppers, chips, keys",
  toolbar: "Toolbar button plates",
  panel: "Popovers, menus and panels",
  sheet: "Sheets, the tab switcher, search and other large panels",
};

const BLOCKS: Record<keyof LookBlocks, Spec> = {
  type: {
    kind: "block",
    noun: "type",
    about: "Fonts and text sizes",
    keys: {
      family: { kind: "family", default: null, about: "The interface font family, like \"Avenir Next\"; left out, the system font. A family macOS doesn't have falls back to the system font" },
      mono: { kind: "family", default: MONO_FAMILY, about: "The monospaced family for codes, keys and logs" },
      scale: number(0.85, 1.3, 1, "Multiplies every text size, after sizes"),
      sizes: {
        kind: "block",
        noun: "text size",
        about: "Text sizes in points, each replacing one step of Ardia's scale",
        keys: Object.fromEntries(Object.entries(TYPE_SIZES).map(([k, v]) => [k, sizeRange(v, SIZE_ABOUT[k as TypeSizeName])])),
      },
      weights: {
        kind: "block",
        noun: "weight",
        about: "What each of Ardia's weight names draws with, from \"100\" (thin) to \"900\" (black)",
        keys: Object.fromEntries(Object.entries(WEIGHTS).map(([k, v]) => [k, { kind: "weight", default: v, about: WEIGHT_ABOUT[k as WeightName] }])),
      },
    },
  },
  metrics: {
    kind: "block",
    noun: "metrics",
    about: "Sizes and corner radii, in points",
    keys: {
      rowHeight: number(24, 56, ROW_METRICS.rowHeight, "Height of a sidebar row: tabs, folders, groups, the New Tab row and the sidebar address field"),
      rowGap: number(0, 12, ROW_METRICS.rowGap, "Space between sidebar rows"),
      pinnedHeight: number(28, 72, ROW_METRICS.pinnedHeight, "Height of a pinned tile in the sidebar's top apps grid"),
      sidebarWidth: number(160, 400, null, `The sidebar's width. The sidebar takes it when you switch to the theme or change this value, and a double-click on its edge returns to it; left out, the width is yours (Ardia's default is ${DEFAULT_SIDEBAR_WIDTH})`),
      radius: {
        kind: "block",
        noun: "radius",
        about: "Corner radii",
        keys: Object.fromEntries(
          Object.entries(THEME_RADII).map(([k, token]) => [k, number(0, k === "sheet" ? 32 : k === "panel" ? 28 : k === "control" ? 12 : 24, RADII[token], RADIUS_ABOUT[k as ThemeRadius])]),
        ),
      },
    },
  },
  layout: {
    kind: "block",
    noun: "layout",
    about: "Which parts of the sidebar show, and where",
    keys: {
      hide: { kind: "parts", about: "Parts of the sidebar to hide" },
      addressField: { kind: "place", default: "top", about: "Where the sidebar address field sits when the address bar is in the sidebar: top or bottom" },
      newTab: { kind: "place", default: null, about: "Where the New Tab row sits: top or bottom of the tab list; left out, Settings › Tabs decides" },
    },
  },
  icons: { kind: "symbols", about: "SF Symbols to draw in place of Ardia's, by name: { \"plus\": \"plus.circle\" }" },
};

export const LOOK_KEYS = Object.keys(BLOCKS) as (keyof LookBlocks)[];

const list = (names: readonly string[]) => names.join(", ");
const ruleOf = (spec: Spec): string => {
  switch (spec.kind) {
    case "number":
      return `must be a number from ${spec.min} to ${spec.max}`;
    case "family":
      return "must be a font family name (1 to 64 characters, no space at either end)";
    case "weight":
      return 'must be a weight from "100" to "900" in steps of 100';
    case "place":
      return `must be one of ${list(PLACES)}`;
    case "parts":
      return `must be a list of parts (${list(CHROME_PARTS)})`;
    case "symbols":
      return "must be an object of SF Symbol names";
    case "block":
      return "must be an object";
  }
};

function checked(spec: Spec, value: unknown, path: string, report: (problem: string) => void): unknown {
  const bad = () => void report(`${path} ${ruleOf(spec)}`);
  switch (spec.kind) {
    case "number":
      if (typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max) return value;
      return bad();
    case "family":
      if (typeof value === "string" && FAMILY.test(value)) return value;
      return bad();
    case "weight": {
      const weight = typeof value === "number" ? String(value) : value;
      if (typeof weight === "string" && (FONT_WEIGHTS as readonly string[]).includes(weight)) return weight;
      return bad();
    }
    case "place":
      if (typeof value === "string" && (PLACES as readonly string[]).includes(value)) return value;
      return bad();
    case "parts": {
      if (!Array.isArray(value)) return bad();
      const parts: ChromePart[] = [];
      for (const part of value) {
        if (typeof part === "string" && (CHROME_PARTS as readonly string[]).includes(part)) parts.push(part as ChromePart);
        else report(`${path} has ${JSON.stringify(part)}, which isn't a part (${list(CHROME_PARTS)})`);
      }
      return parts;
    }
    case "symbols": {
      if (!isFields(value)) return bad();
      const icons: Record<string, string> = {};
      for (const [name, replacement] of Object.entries(value)) {
        if (!SYMBOL.test(name)) report(`${path} has ${JSON.stringify(name)}, which isn't an SF Symbol name (lowercase letters, digits and dots)`);
        else if (typeof replacement !== "string" || !SYMBOL.test(replacement)) report(`${path}.${name} must be an SF Symbol name (lowercase letters, digits and dots)`);
        else icons[name] = replacement;
      }
      return icons;
    }
    case "block": {
      if (!isFields(value)) return bad();
      const out: Fields = {};
      for (const [key, given] of Object.entries(value)) {
        const sub = Object.hasOwn(spec.keys, key) ? spec.keys[key]! : null;
        if (!sub) {
          report(`${path}.${key} isn't a ${spec.noun} key (${list(Object.keys(spec.keys))})`);
          continue;
        }
        const ok = checked(sub, given, `${path}.${key}`, report);
        if (ok !== undefined) out[key] = ok;
      }
      return out;
    }
  }
}

export function parseLookBlocks(file: string, doc: Fields, problems: string[]): LookBlocks {
  const blocks: LookBlocks = {};
  for (const key of LOOK_KEYS) {
    if (doc[key] === undefined) continue;
    const value = checked(BLOCKS[key], doc[key], key, (problem) => problems.push(`${file}: ${problem}`));
    if (value !== undefined) (blocks as Fields)[key] = value;
  }
  return blocks;
}

const fieldsOf = (value: unknown): Fields => (isFields(value) ? value : {});
const hasContent = (value: unknown): boolean => (isFields(value) ? Object.values(value).some(hasContent) : Array.isArray(value) ? value.length > 0 : value !== undefined);
const numberOr = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);
const round = (value: number) => Math.round(value * 100) / 100;

const DEFAULT_SIZES: Record<TypeSizeName, number> = { ...TYPE_SIZES };
const DEFAULT_RADII: Record<RadiusName, number> = { ...RADII };

export const DEFAULT_LOOK: ThemeLook = {
  family: null,
  mono: MONO_FAMILY,
  sizes: DEFAULT_SIZES,
  weights: { ...WEIGHTS },
  metrics: { ...ROW_METRICS },
  sidebarWidth: null,
  radii: DEFAULT_RADII,
  hidden: new Set(),
  addressField: "top",
  newTab: null,
  icons: new Map(),
};

export function resolveLook(blocks: LookBlocks | null | undefined): ThemeLook {
  if (!blocks || !LOOK_KEYS.some((key) => hasContent(blocks[key]))) return DEFAULT_LOOK;
  const type = fieldsOf(blocks.type);
  const metrics = fieldsOf(blocks.metrics);
  const layout = fieldsOf(blocks.layout);
  const scale = numberOr(type.scale, 1);
  const sizes = fieldsOf(type.sizes);
  const weights = fieldsOf(type.weights);
  const radius = fieldsOf(metrics.radius);
  const radii = { ...DEFAULT_RADII };
  for (const [key, token] of Object.entries(THEME_RADII)) radii[token] = numberOr(radius[key], RADII[token]);
  return {
    family: typeof type.family === "string" ? type.family : null,
    mono: typeof type.mono === "string" ? type.mono : MONO_FAMILY,
    sizes: Object.fromEntries(Object.entries(TYPE_SIZES).map(([k, v]) => [k, round(numberOr(sizes[k], v) * scale)])) as Record<TypeSizeName, number>,
    weights: { ...WEIGHTS, ...(weights as Partial<Record<WeightName, FontWeight>>) },
    metrics: {
      rowHeight: numberOr(metrics.rowHeight, ROW_METRICS.rowHeight),
      rowGap: numberOr(metrics.rowGap, ROW_METRICS.rowGap),
      pinnedHeight: numberOr(metrics.pinnedHeight, ROW_METRICS.pinnedHeight),
    },
    sidebarWidth: typeof metrics.sidebarWidth === "number" ? metrics.sidebarWidth : null,
    radii,
    hidden: new Set(Array.isArray(layout.hide) ? (layout.hide as ChromePart[]) : []),
    addressField: layout.addressField === "bottom" ? "bottom" : "top",
    newTab: layout.newTab === "top" || layout.newTab === "bottom" ? layout.newTab : null,
    icons: new Map(Object.entries(blocks.icons ?? {})),
  };
}

export type LookUse = { type: boolean; metrics: boolean; layout: boolean; icons: boolean; hidden: number; moved: number; iconOverrides: number };

export function lookUse(blocks: LookBlocks | null | undefined): LookUse {
  const look = resolveLook(blocks);
  const has = (key: keyof LookBlocks) => hasContent(blocks?.[key]);
  return {
    type: has("type"),
    metrics: has("metrics"),
    layout: has("layout"),
    icons: has("icons"),
    hidden: look.hidden.size,
    moved: (look.addressField !== DEFAULT_LOOK.addressField ? 1 : 0) + (look.newTab !== null ? 1 : 0),
    iconOverrides: look.icons.size,
  };
}

function specSchema(spec: Spec): JsonSchema {
  const about = { description: spec.about };
  switch (spec.kind) {
    case "number":
      return { type: "number", minimum: spec.min, maximum: spec.max, ...(spec.default === null ? {} : { default: spec.default }), ...about };
    case "family":
      return { type: "string", pattern: FAMILY_PATTERN, ...(spec.default === null ? {} : { default: spec.default }), ...about };
    case "weight":
      return { enum: [...FONT_WEIGHTS, ...FONT_WEIGHTS.map(Number)], default: spec.default, ...about };
    case "place":
      return { type: "string", enum: PLACES, ...(spec.default === null ? {} : { default: spec.default }), ...about };
    case "parts":
      return { type: "array", items: { type: "string", enum: CHROME_PARTS }, default: [], ...about };
    case "symbols":
      return { type: "object", propertyNames: { type: "string", pattern: SYMBOL_PATTERN }, additionalProperties: { type: "string", pattern: SYMBOL_PATTERN }, default: {}, ...about };
    case "block":
      return { type: "object", properties: Object.fromEntries(Object.entries(spec.keys).map(([k, sub]) => [k, specSchema(sub)])), additionalProperties: false, ...about };
  }
}

export function lookSchemas(): Record<keyof LookBlocks, JsonSchema> {
  return Object.fromEntries(LOOK_KEYS.map((key) => [key, specSchema(BLOCKS[key])])) as Record<keyof LookBlocks, JsonSchema>;
}

export function lookDefaults(): Required<Pick<LookBlocks, "type" | "metrics" | "layout">> & { icons: Record<string, string> } {
  const defaults = (spec: Spec): unknown => {
    if (spec.kind === "block") {
      const out: Fields = {};
      for (const [k, sub] of Object.entries(spec.keys)) {
        const value = defaults(sub);
        if (value !== undefined) out[k] = value;
      }
      return out;
    }
    if (spec.kind === "parts") return [];
    if (spec.kind === "symbols") return {};
    return spec.default ?? undefined;
  };
  return { type: defaults(BLOCKS.type) as Fields, metrics: defaults(BLOCKS.metrics) as Fields, layout: defaults(BLOCKS.layout) as Fields, icons: {} };
}
