import { Easing } from "react-native";

export const curve = { easeOut: Easing.bezier(0, 0, 0.58, 1) } as const;

export const duration = { resultsIn: 140, progressFill: 200, progressFade: 250, progressAdvance: 450, toneFade: 250 } as const;

export const delay = { progressReveal: 150 } as const;

export const springs = {
  searchRise: { stiffness: (2 * Math.PI / 0.39) ** 2, damping: 4 * Math.PI / 0.39, mass: 1 },
  barPress: { stiffness: (2 * Math.PI / 0.12) ** 2, damping: 4 * Math.PI * 0.9 / 0.12, mass: 1 },
} as const;
