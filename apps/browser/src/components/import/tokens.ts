export const importColors = {
  windowFill: { dark: "#1E1E1E", light: "#F4F4F4" },
  monogramFallback: "#8E8E93",
  dropBorder: { dark: "rgba(255,255,255,0.25)", light: "rgba(0,0,0,0.2)" },
} as const;

export const accentAlpha = { selected: "26", active: "1F", activeBorder: "66", dropOver: "1A" } as const;

export const importType = { heading: 22, done: 20, rowTitle: 13.5, emoji: 15, bodyLine: 18, smallLine: 17 } as const;

export const importLayout = {
  dragRegion: 40,
  padX: 32,
  padTop: 46,
  footerHeight: 56,
  browserRow: 52,
  selectRow: 48,
  categoryRow: 44,
  selectedBorder: 1.5,
  avatar: 28,
  spaceIconRadius: 8,
  appIcon: 56,
  safariIcon: 40,
  stepBadge: 20,
  dropHeight: 130,
  textMax: 420,
  diaTextMax: 440,
  loadingTop: 80,
  doneTop: 40,
} as const;

export const importMotion = {
  rowAppear: { duration: 260, stagger: 70, rise: 8 },
  doneDelay: 700,
  check: { friction: 5, tension: 160 },
  success: { friction: 5, tension: 120, from: 0.4 },
} as const;
