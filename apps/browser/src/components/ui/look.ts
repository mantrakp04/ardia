import type { TextStyle } from "react-native";
import { activeLook } from "../../lib/activeLook";
import { DEFAULT_LOOK, TYPE_SIZES, type FontWeight, type ThemeLook, type TypeSizeName } from "../../lib/themeLook";

const LINE_HEIGHTS = { badge: 11, tiny: 13, caption: 14, small: 15, body: 16, title: 20, large: 22, display: 32 } as const;
const PROSE_LINE_HEIGHTS = { small: 17, body: 18 } as const;

type FontStyle = { readonly fontSize: number; readonly fontFamily?: string };
type Face = { readonly fontFamily?: string };
type Derived = {
  font: Record<TypeSizeName, FontStyle>;
  lineHeight: Record<keyof typeof LINE_HEIGHTS, number>;
  prose: Record<keyof typeof PROSE_LINE_HEIGHTS, number>;
  face: Face;
  mono: { readonly fontFamily: string };
  styled: WeakMap<object, object>;
  monoStyled: WeakMap<object, object>;
};

const NO_FACE: Face = {};
const sizesOf = Object.keys(TYPE_SIZES) as TypeSizeName[];

function derive(look: ThemeLook): Derived {
  const face = look.family ? { fontFamily: look.family } : NO_FACE;
  const ratio = (size: TypeSizeName) => look.sizes[size] / TYPE_SIZES[size];
  const scaled = (value: number, size: TypeSizeName) => (look === DEFAULT_LOOK ? value : Math.round(value * ratio(size)));
  return {
    font: Object.fromEntries(sizesOf.map((size) => [size, { fontSize: look.sizes[size], ...face }])) as Record<TypeSizeName, FontStyle>,
    lineHeight: { ...Object.fromEntries(sizesOf.map((size) => [size, scaled(LINE_HEIGHTS[size], size)])), display: scaled(LINE_HEIGHTS.display, "body") } as Derived["lineHeight"],
    prose: { small: scaled(PROSE_LINE_HEIGHTS.small, "small"), body: scaled(PROSE_LINE_HEIGHTS.body, "body") },
    face,
    mono: { fontFamily: look.mono },
    styled: new WeakMap(),
    monoStyled: new WeakMap(),
  };
}

let lastLook: ThemeLook | null = null;
let last: Derived = derive(DEFAULT_LOOK);

function current(): Derived {
  const look = activeLook();
  if (look !== lastLook) {
    lastLook = look;
    last = derive(look);
  }
  return last;
}

export const font = {
  get badge() { return current().font.badge; },
  get tiny() { return current().font.tiny; },
  get caption() { return current().font.caption; },
  get small() { return current().font.small; },
  get body() { return current().font.body; },
  get title() { return current().font.title; },
  get large() { return current().font.large; },
};

export const lineHeight = {
  get badge() { return current().lineHeight.badge; },
  get tiny() { return current().lineHeight.tiny; },
  get caption() { return current().lineHeight.caption; },
  get small() { return current().lineHeight.small; },
  get body() { return current().lineHeight.body; },
  get title() { return current().lineHeight.title; },
  get large() { return current().lineHeight.large; },
  get display() { return current().lineHeight.display; },
};

export const proseLineHeight = {
  get small() { return current().prose.small; },
  get body() { return current().prose.body; },
};

export const weight = {
  get regular(): FontWeight { return activeLook().weights.regular; },
  get medium(): FontWeight { return activeLook().weights.medium; },
  get semibold(): FontWeight { return activeLook().weights.semibold; },
  get bold(): FontWeight { return activeLook().weights.bold; },
};

export const radius = {
  get none() { return activeLook().radii.none; },
  get hair() { return activeLook().radii.hair; },
  get control() { return activeLook().radii.control; },
  get tile() { return activeLook().radii.tile; },
  get panel() { return activeLook().radii.panel; },
  get sheet() { return activeLook().radii.sheet; },
  get hero() { return activeLook().radii.hero; },
  get chrome() { return activeLook().radii.chrome; },
  get toolbar() { return activeLook().radii.toolbar; },
  get pinned() { return activeLook().radii.pinned; },
};

export const typeFace = (): Face => current().face;

export function perLook<T>(make: () => T): () => T {
  let madeFor: ThemeLook | null = null;
  let value: T;
  return () => {
    const look = activeLook();
    if (look !== madeFor) {
      value = make();
      madeFor = look;
    }
    return value;
  };
}

export const monoFace = (): { readonly fontFamily: string } => current().mono;

export function withFace<T extends TextStyle>(style: T): T {
  const derived = current();
  if (derived.face === NO_FACE) return style;
  let out = derived.styled.get(style) as T | undefined;
  if (!out) derived.styled.set(style, (out = { ...style, ...derived.face }));
  return out;
}

export function withMono<T extends TextStyle>(style: T): T & { fontFamily: string } {
  const derived = current();
  let out = derived.monoStyled.get(style) as (T & { fontFamily: string }) | undefined;
  if (!out) derived.monoStyled.set(style, (out = { ...style, ...derived.mono }));
  return out;
}
