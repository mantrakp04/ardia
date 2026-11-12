import { readDocument, writeDocument } from "../../platform/documents";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import type { BrowserSourceId, Preset } from "./presets";
import type { OnboardingStep, QuestionId } from "./questionList";

const DOC = "onboarding.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
export type Saved = {
  startedAt?: number;
  completedAt: number | null;
  step?: OnboardingStep;
  sub?: number;
  source?: BrowserSourceId | null;
  preset?: Preset;
  picked?: Partial<Record<QuestionId, string[]>>;
  defaultBrowserTrialStartedAt?: number;
  defaultBrowserCheckInDoneAt?: number;
  introMusicMuted?: boolean;
};

export function readSaved(): Saved | null {
  try {
    return parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS) as Saved | null;
  } catch {
    return null;
  }
}

export function saveOnboarding(patch: Partial<Saved>) {
  try {
    writeDocument(DOC, versionedJson({ completedAt: null, ...readSaved(), ...patch } satisfies Saved, DOC_VERSION));
  } catch (error) {
    console.warn("Couldn't save onboarding state", error);
  }
}

export const markCompleted = () => saveOnboarding({ completedAt: Date.now() });

export const recordDefaultBrowserTrial = () => saveOnboarding({ defaultBrowserTrialStartedAt: Date.now() });

export const defaultBrowserTrialStartedAt = () => readSaved()?.defaultBrowserTrialStartedAt ?? null;

export const defaultBrowserCheckInDoneAt = () => readSaved()?.defaultBrowserCheckInDoneAt ?? null;
export const recordDefaultBrowserCheckInDone = () => saveOnboarding({ defaultBrowserCheckInDoneAt: Date.now() });

export const onboardingCompletedAt = () => readSaved()?.completedAt ?? null;

export const introMusicMuted = () => readSaved()?.introMusicMuted ?? false;
export const saveIntroMusicMuted = (muted: boolean) => saveOnboarding({ introMusicMuted: muted });

export const forgetOnboardingProgress = () =>
  writeDocument(DOC, versionedJson({ completedAt: null, startedAt: Date.now(), introMusicMuted: introMusicMuted() } satisfies Saved, DOC_VERSION));
