export type DeckGeometry = {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  cardWidth: number;
  cardHeight: number;
  focusLeading: number;
  spacing: number;
  leftReach: number;
  cardCenterY: number;
  barCenterY: number;
  tabButtonX: number;
};

export const DECK = {
  cardWidthRatio: 306 / 440,
  focusLeadingRatio: 66 / 440,
  leftPeek: 70,
  stepRatio: 218 / 440,
  headerHeight: 20,
  barReserve: 58,
  topReserve: 12,
  launcherStartWidth: 22,
  launcherStartRadius: 4,
  cardRadius: 13,
  displayCornerRadius: 55,
} as const;

function reach(peek: number, spacing: number): number {
  const clamped = Math.max(peek, 8);
  let value = clamped;
  for (let i = 0; i < 6; i++) value = clamped / (1 - Math.exp(-spacing / value));
  return value;
}

export function deckGeometry(width: number, height: number, safeTop: number, safeBottom: number, safeSide = 0): DeckGeometry {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const bandTop = safeTop + DECK.topReserve + DECK.headerHeight;
  const bandBottom = h - Math.max(safeBottom, 20) - DECK.barReserve + 24;
  const band = Math.max(bandBottom - bandTop, 120);
  const aspect = h / w;
  const cardWidth = Math.min(w * DECK.cardWidthRatio, band / aspect);
  const focusLeading = w * DECK.focusLeadingRatio;
  const spacing = Math.min(cardWidth, w * DECK.stepRatio);
  return {
    width: w,
    height: h,
    safeTop,
    safeBottom,
    cardWidth,
    cardHeight: cardWidth * aspect,
    focusLeading,
    spacing,
    leftReach: reach(Math.min(DECK.leftPeek, focusLeading - 6), spacing),
    cardCenterY: bandTop + band / 2,
    barCenterY: h - Math.max(safeBottom, 20) - 6,
    tabButtonX: safeSide + 16 + 17.5,
  };
}

export function deckLeading(g: DeckGeometry, relative: number): number {
  "worklet";
  if (relative >= 0) return g.focusLeading + g.spacing * relative;
  return g.focusLeading - g.leftReach * (1 - Math.exp((relative * g.spacing) / g.leftReach));
}

export function deckVisibleWidth(g: DeckGeometry, relative: number, isLast: boolean): number {
  "worklet";
  if (isLast) return g.cardWidth;
  return Math.min(g.cardWidth, Math.max(0, deckLeading(g, relative + 1) - deckLeading(g, relative)));
}

export function swiftRound(value: number): number {
  "worklet";
  const magnitude = Math.floor(Math.abs(value) + 0.5);
  return value < 0 ? -magnitude : magnitude;
}

export function deckRubberBand(scroll: number, count: number): number {
  "worklet";
  const upper = Math.max(count - 1, 0);
  if (scroll < 0) return -Math.pow(-scroll, 0.7) * 0.35;
  if (scroll > upper) return upper + Math.pow(scroll - upper, 0.7) * 0.35;
  return scroll;
}

export function deckSettleTarget(g: DeckGeometry, scroll: number, velocity: number, count: number): number {
  "worklet";
  if (count <= 0) return 0;
  const projected = scroll - (velocity / g.spacing) * 0.22;
  return Math.min(Math.max(swiftRound(projected), 0), count - 1);
}

export function deckShouldClose(translation: number, velocity: number, cardHeight: number): boolean {
  "worklet";
  if (translation >= 0) return false;
  if (velocity < -500) return true;
  return -translation > cardHeight / 3 && velocity < 250;
}

export function deckCardAt(g: DeckGeometry, count: number, scroll: number, x: number, y: number): number {
  "worklet";
  if (count <= 0) return -1;
  const half = g.cardHeight / 2;
  if (y < g.cardCenterY - half || y > g.cardCenterY + half) return -1;
  for (let index = count - 1; index >= 0; index--) {
    const leading = deckLeading(g, index - scroll);
    if (x >= leading && x <= leading + g.cardWidth) return index;
  }
  return -1;
}

export const focusedIndex = (scroll: number, count: number) => Math.min(Math.max(swiftRound(scroll), 0), Math.max(count - 1, 0));

export const initialDeckScroll = (count: number) => Math.max(0, count - 2);

export const openingDeckScroll = (index: number, count: number) => (index < count - 1 ? index : Math.max(0, Math.min(index - 1, count - 1)));

export const scrollAfterRemoving = (removed: number, scroll: number, remaining: number) => {
  if (remaining <= 0) return 0;
  const shifted = removed < scroll ? scroll - 1 : scroll;
  return Math.min(Math.max(shifted, 0), remaining - 1);
};

export const lerp = (from: number, to: number, t: number) => {
  "worklet";
  return from + (to - from) * t;
};
