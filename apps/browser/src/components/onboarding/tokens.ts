import { duration } from "../ui/motion";
import { colorRoles, ink } from "../ui/tokens";

const dark = {
  background: "#000000",
  overlay: "rgba(0,0,0,0.6)",
  card: "#161616",
  cardBorder: "rgba(255,255,255,0.3)",
  title: "#FFFFFF",
  subtitle: "rgba(255,255,255,0.6)",
  body: "rgba(255,255,255,0.55)",
  footnote: "rgba(255,255,255,0.5)",
  steps: "rgba(255,255,255,0.3)",
  row: "rgba(255,255,255,0.08)",
  rowBorder: "rgba(255,255,255,0.16)",
  rowSubtitle: "rgba(255,255,255,0.6)",
  primary: "rgba(255,255,255,0.85)",
  primaryHover: "rgba(255,255,255,0.9)",
  primaryText: colorRoles.dark.onPrimary,
  button: "rgba(255,255,255,0.08)",
  buttonHover: "rgba(255,255,255,0.1)",
  buttonText: "#FFFFFF",
  outlinedHover: "rgba(255,255,255,0.03)",
  noThanksBorder: "rgba(255,255,255,0.2)",
  noThanksText: "rgba(255,255,255,0.5)",
  iconContainer: "rgba(255,255,255,0.15)",
  separator: colorRoles.dark.divider,
  preview: "rgba(255,255,255,0.04)",
  previewBorder: "rgba(255,255,255,0.1)",
  progressTrack: "rgba(255,255,255,0.12)",
  progressFill: "#FDD023",
  checkbox: colorRoles.dark.ringRadioFill,
  checkboxBorder: colorRoles.dark.ringRadioBorder,
  checkboxOn: colorRoles.dark.ringRadioOn,
  checkmark: colorRoles.dark.onPrimary,
  tourScrim: "#00000080",
};

export type OnboardingColors = typeof dark;

const light: OnboardingColors = {
  background: "#FFFFFF",
  overlay: "rgba(255,255,255,0.6)",
  card: "#FFFFFF",
  cardBorder: "rgba(0,0,0,0.08)",
  title: "#000000",
  subtitle: "rgba(0,0,0,0.53)",
  body: "rgba(0,0,0,0.55)",
  footnote: "rgba(0,0,0,0.5)",
  steps: "rgba(0,0,0,0.3)",
  row: "rgba(0,0,0,0.015)",
  rowBorder: "rgba(0,0,0,0.08)",
  rowSubtitle: "rgba(0,0,0,0.6)",
  primary: "rgba(0,0,0,0.85)",
  primaryHover: "rgba(0,0,0,0.9)",
  primaryText: colorRoles.light.onPrimary,
  button: "rgba(0,0,0,0.08)",
  buttonHover: "rgba(0,0,0,0.1)",
  buttonText: "#000000",
  outlinedHover: "rgba(0,0,0,0.03)",
  noThanksBorder: "rgba(0,0,0,0.1)",
  noThanksText: "rgba(0,0,0,0.5)",
  iconContainer: "rgba(0,0,0,0.03)",
  separator: colorRoles.light.divider,
  preview: "rgba(0,0,0,0.025)",
  previewBorder: "rgba(0,0,0,0.07)",
  progressTrack: "rgba(0,0,0,0.08)",
  progressFill: "#FDD023",
  checkbox: colorRoles.light.ringRadioFill,
  checkboxBorder: colorRoles.light.ringRadioBorder,
  checkboxOn: colorRoles.light.ringRadioOn,
  checkmark: colorRoles.light.onPrimary,
  tourScrim: "#0000004D",
};

export const onboardingColors = { dark, light } as const;

export const trafficLights = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

export const receiptStamp = "#2F9E5B";

export const tourRing = "#FFFFFFB3";

export const onboardingCard = { radius: 20, shadow: { color: ink.black, opacity: 0.28, radius: 40, offset: [0, 18] as [number, number] } } as const;

export const onboardingButton = { height: 36, primaryPad: 20, secondaryPad: 18, pressScale: 0.98, circlePressScale: 0.96, disabledOpacity: 0.4 } as const;

export const onboardingMotion = {
  overlayIn: 260,
  overlayOut: 420,
  reveal: 420,
  checkMark: 140,
  mockOverlay: 220,
  introSkip: 280,
  tourIn: 240,
  tourOut: 200,
  tourPulse: duration.pulse,
  swatch: duration.toggle,
} as const;

export const onboardingType = {
  wordmark: { fontSize: 64, fontWeight: "200", letterSpacing: -1.5 },
  tagline: { fontSize: 17, fontWeight: "300" },
  stepTitle: { fontSize: 26, lineHeight: 31, fontWeight: "300", letterSpacing: -0.4 },
  stepSubtitle: { fontSize: 13.5, lineHeight: 19 },
  bodyCompact: { fontSize: 12.5 },
  postcardHello: { fontSize: 20, fontWeight: "300", fontStyle: "italic" },
  stamp: { fontSize: 6, fontWeight: "700", letterSpacing: 0.4 },
  galleryCaption: { fontSize: 10.5, lineHeight: 14, fontWeight: "500" },
  receiptSmall: { fontSize: 9.5, letterSpacing: 0.6 },
  receiptStamp: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  coachCount: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.4 },
  coachTitle: { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
} as const;

export const MONO = "Menlo";
