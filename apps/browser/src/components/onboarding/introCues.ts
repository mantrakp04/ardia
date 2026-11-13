import type { IntroMusicCues } from "../../state/onboarding/onboarding";

export const WORDMARK = "Ardia";
export const LETTER = 0.52;
export const TAGLINE = 0.6;
export const EXIT = 0.65;

export const INTRO_CUES: IntroMusicCues = (() => {
  const icon = 0.25;
  const letters = 1.15;
  const letterStep = 0.055;
  const letterCount = WORDMARK.length;
  const tagline = letters + (letterCount - 1) * letterStep + LETTER + 0.15;
  const exit = tagline + TAGLINE + 1.1;
  return { icon, letters, letterStep, letterCount, tagline, exit, end: exit + EXIT };
})();
