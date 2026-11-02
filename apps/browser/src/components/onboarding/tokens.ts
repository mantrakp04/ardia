import { duration, period } from "../ui/motion";
import type { Theme } from "../ui/theme";
import { display, font, ink, lineHeight, proseLineHeight, radius, space, tracking } from "../ui/tokens";

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
  button: "rgba(255,255,255,0.08)",
  buttonHover: "rgba(255,255,255,0.1)",
  buttonText: "#FFFFFF",
  outlinedHover: "rgba(255,255,255,0.03)",
  noThanksBorder: "rgba(255,255,255,0.2)",
  noThanksText: "rgba(255,255,255,0.5)",
  iconContainer: "rgba(255,255,255,0.15)",
  preview: "rgba(255,255,255,0.04)",
  previewBorder: "rgba(255,255,255,0.1)",
  progressTrack: "rgba(255,255,255,0.12)",
  progressFill: "#FDD023",
  tourScrim: "#00000080",
};

export type OnboardingColors = typeof dark & {
  primaryText: string;
  separator: string;
  checkbox: string;
  checkboxBorder: string;
  checkboxOn: string;
  checkmark: string;
};

const light: typeof dark = {
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
  button: "rgba(0,0,0,0.08)",
  buttonHover: "rgba(0,0,0,0.1)",
  buttonText: "#000000",
  outlinedHover: "rgba(0,0,0,0.03)",
  noThanksBorder: "rgba(0,0,0,0.1)",
  noThanksText: "rgba(0,0,0,0.5)",
  iconContainer: "rgba(0,0,0,0.03)",
  preview: "rgba(0,0,0,0.025)",
  previewBorder: "rgba(0,0,0,0.07)",
  progressTrack: "rgba(0,0,0,0.08)",
  progressFill: "#FDD023",
  tourScrim: "#0000004D",
};

const byTheme = new WeakMap<Theme, OnboardingColors>();

export function onboardingColorsOf(theme: Theme): OnboardingColors {
  let colors = byTheme.get(theme);
  if (!colors) {
    const roles = {
      primaryText: theme.onPrimary,
      separator: theme.divider,
      checkbox: theme.ringRadioFill,
      checkboxBorder: theme.ringRadioBorder,
      checkboxOn: theme.ringRadioOn,
      checkmark: theme.onPrimary,
    };
    byTheme.set(theme, (colors = { ...(theme.dark ? dark : light), ...roles }));
  }
  return colors;
}

export const trafficLights = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

export const receiptStamp = "#2F9E5B";

export const tourRing = "#FFFFFFB3";

export const onboardingCard = { radius: radius.hero, shadow: { color: ink.black, opacity: 0.28, radius: 40, offset: [0, 18] as [number, number] } } as const;

export const onboardingButton = { height: 36, primaryPad: space.xxl, secondaryPad: space.xl, pressScale: 0.98, circlePressScale: 0.96, disabledOpacity: 0.4 } as const;

export const onboardingMotion = {
  overlayIn: duration.slow,
  overlayOut: duration.long,
  reveal: duration.long,
  checkMark: duration.base,
  mockOverlay: duration.slow,
  introSkip: duration.slow,
  tourIn: duration.slow,
  tourOut: duration.base,
  tourPulse: period.pulse,
  swatch: duration.base,
} as const;

export const onboardingType = {
  wordmark: { ...display.wordmark, fontWeight: "200" },
  tagline: { ...font.large, fontWeight: "300" },
  stepTitle: { ...display.large, lineHeight: lineHeight.display, fontWeight: "300" },
  stepSubtitle: { ...font.body, lineHeight: proseLineHeight.body },
  bodyCompact: font.small,
  postcardHello: { ...display.title, fontWeight: "300", fontStyle: "italic" },
  galleryCaption: { ...font.tiny, lineHeight: lineHeight.tiny, fontWeight: "500" },
  receiptSmall: { ...font.badge, letterSpacing: tracking.caps },
  receiptStamp: { ...font.tiny, fontWeight: "700", letterSpacing: tracking.wide },
  coachCount: { ...font.tiny, fontWeight: "600", letterSpacing: tracking.caps },
  coachTitle: { ...font.title, fontWeight: "600" },
} as const;

export const MONO = "Menlo";

export const CONTENT_WIDTH = 368;

export const TILE_WIDTH = (CONTENT_WIDTH - space.m * 3) / 4;
