import { Easing } from "react-native";
import { Easing as WorkletEasing } from "react-native-reanimated";

export const curve = { easeOut: Easing.bezier(0, 0, 0.58, 1) } as const;

export const duration = { resultsIn: 140, progressFill: 200, progressFade: 250, progressAdvance: 450, toneFade: 250 } as const;

export const delay = { progressReveal: 150 } as const;

export const spring = (response: number, dampingFraction: number) => {
  const stiffness = (2 * Math.PI / response) ** 2;
  return { stiffness, damping: 2 * dampingFraction * Math.sqrt(stiffness), mass: 1 };
};

export const tabsMotion = {
  openScale: spring(0.19, 1),
  openPosition: spring(0.3, 1),
  expand: spring(0.3, 1),
  release: spring(0.3, 0.9),
  settle: spring(0.4, 1),
  gapClose: spring(0.4, 0.8),
  pagerSettle: spring(0.38, 1),
  fade: 200,
  flyAway: 200,
  barTone: 250,
  menu: 160,
  longPress: 400,
  sheetIn: spring(0.39, 1),
  sheetOut: spring(0.32, 1),
  surfaceFade: 200,
  barCollapse: spring(0.4, 1),
  sheetRise: spring(0.42, 0.9),
  sheetDismiss: spring(0.32, 1),
  sheetReduced: 200,
  toneFade: 300,
  barCollapseReduced: 200,
} as const;

export const tabsCurve = { easeOut: WorkletEasing.bezier(0, 0, 0.58, 1), easeInOut: WorkletEasing.bezier(0.42, 0, 0.58, 1) } as const;

export const springs = {
  searchRise: { stiffness: (2 * Math.PI / 0.39) ** 2, damping: 4 * Math.PI / 0.39, mass: 1 },
  barPress: { stiffness: (2 * Math.PI / 0.12) ** 2, damping: 4 * Math.PI * 0.9 / 0.12, mass: 1 },
} as const;
