import { readDocument, writeDocument } from "../../platform/documents";
import { stopIntroMusic } from "../../platform/introMusic";
import { devTestValue } from "../../platform/launchConfig";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { resolveWindowId, tabLayoutOf } from "../browser/model";
import type { Settings } from "../settings/settings";
import type { ProfileColor, ProfileTheme } from "../browser/types";
import { PRESETS, presetFor, setsUpLikeBrowser, type BrowserSourceId, type Preset } from "./presets";
import { endToolTour, startToolTour } from "./tour";
import { stepsForThisSurface } from "./demoSteps";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

export { playIntroMusic, setIntroMusicMuted, stopIntroMusic, type IntroMusicCues } from "../../platform/introMusic";
export { PRESET_NAMES, PRESETS, presetFor, setsUpLikeBrowser, type BrowserSourceId, type Preset } from "./presets";

export type OnboardingStep = "intro" | "source" | "layout" | "tabs" | "look" | "searchPrivacy" | "pins" | "home" | "outro";

export const STEPS: OnboardingStep[] = stepsForThisSurface(["intro", "source", "layout", "tabs", "look", "searchPrivacy", "pins", "home", "outro"]);

export type QuestionId =
  | "source"
  | "tabs"
  | "address"
  | "cmdl"
  | "newTab"
  | "newTabPosition"
  | "tidy"
  | "quit"
  | "windows"
  | "tabsMore"
  | "color"
  | "appearance"
  | "siteColor"
  | "lookMore"
  | "engine"
  | "typed"
  | "crash"
  | "pins"
  | "default"
  | "links"
  | "outro";

type Question = { id: QuestionId; keys: readonly (keyof Settings)[] };

const QUESTIONS: Record<Exclude<OnboardingStep, "intro">, Question[]> = {
  source: [{ id: "source", keys: [] }],
  layout: [
    { id: "tabs", keys: ["tabLayout"] },
    { id: "address", keys: ["addressBar"] },
    { id: "cmdl", keys: ["commandBarPlacement"] },
  ],
  tabs: [
    { id: "newTab", keys: ["newTabOpens"] },
    { id: "newTabPosition", keys: ["newTabPosition", "newTabButtonPosition"] },
    { id: "tidy", keys: ["cleanUpInactiveTabsAfterHours"] },
    { id: "quit", keys: ["restoreSession"] },
    { id: "windows", keys: ["shareTabsAcrossWindows"] },
    { id: "tabsMore", keys: ["balancedTopApps", "peekModifier", "undoReopensClosedTab", "cmdClickCreatesTabGroup"] },
  ],
  look: [
    { id: "color", keys: [] },
    { id: "appearance", keys: ["appearance"] },
    { id: "siteColor", keys: ["extendWebsiteColor"] },
    { id: "lookMore", keys: ["hideToolbarWhileScrolling", "bookmarksBar"] },
  ],
  searchPrivacy: [
    { id: "engine", keys: ["searchEngine"] },
    { id: "typed", keys: ["commandBarPreference"] },
    { id: "crash", keys: [] },
  ],
  pins: [{ id: "pins", keys: [] }],
  home: [
    { id: "default", keys: [] },
    { id: "links", keys: ["openLinksInLittleArdia"] },
  ],
  outro: [{ id: "outro", keys: [] }],
};

export const QUESTION_ORDER: QuestionId[] = Object.values(QUESTIONS).flatMap((list) => list.map((q) => q.id));

const answeredByPreset = (q: Question, preset: Preset) => q.keys.length > 0 && q.keys.every((k) => k in PRESETS[preset]);

export function questionsFor(step: OnboardingStep): Question[] {
  if (step === "intro") return [];
  const { windowId, draft, preset, source } = useOnboarding.getState();
  const list = setsUpLikeBrowser(source) ? QUESTIONS[step].filter((q) => !answeredByPreset(q, preset)) : QUESTIONS[step];
  if (step !== "layout") return list;
  const b = useBrowser.getState();
  const { tabLayout } = resolveDraft(["tabLayout"], draft, preset, { ...b.settings, tabLayout: tabLayoutOf(b, windowId) });
  return tabLayout === "top" ? list.filter((q) => q.id !== "address") : list;
}

export const activeSteps = () => STEPS.filter((step) => step === "intro" || questionsFor(step).length > 0);

export const presetPatch = (source: BrowserSourceId | null): Partial<Settings> => (setsUpLikeBrowser(source) ? PRESETS[source] : {});

export type Extras = {
  color: ProfileColor;
  appIcon: string;
  share: boolean;
  pins: string[];
  setDefault: boolean;
  trial: boolean;
  dock: boolean;
  login: boolean;
};

type LiveBaseline = Partial<Settings> & { color?: ProfileColor; theme?: ProfileTheme | null };

type OnboardingState = {
  windowId: string | null;
  step: OnboardingStep;
  sub: number;
  leaving: boolean;
  session: number;
  tourAfter: boolean;
  preset: Preset;
  source: BrowserSourceId | null;
  draft: Partial<Settings>;
  extras: Partial<Extras>;
  baseline: LiveBaseline;
  picked: Partial<Record<QuestionId, string[]>>;
};

const stepAfter = (step: OnboardingStep, delta: number) => {
  const steps = activeSteps();
  return steps[steps.indexOf(step) + delta];
};

const setWindowLayout = (windowId: string, tabLayout: Settings["tabLayout"]) =>
  useBrowser.setState((s) => {
    const w = s.windows[windowId];
    return w && w.tabLayout !== tabLayout ? { windows: { ...s.windows, [windowId]: { ...w, tabLayout } } } : {};
  });

export const useOnboarding = create<OnboardingState>()(() => ({
  windowId: null,
  step: "intro",
  sub: 0,
  leaving: false,
  session: 0,
  tourAfter: false,
  preset: "dia",
  source: null,
  draft: {},
  extras: {},
  baseline: {},
  picked: {},
}));

export function goToStep(step: OnboardingStep, sub = 0) {
  useOnboarding.setState({ step, sub });
  save({ step, sub });
}

export function nextStep() {
  const { step, sub } = useOnboarding.getState();
  if (sub < questionsFor(step).length - 1) return goToStep(step, sub + 1);
  const after = stepAfter(step, 1);
  if (after) goToStep(after);
  else finishOnboarding();
}

export function previousStep() {
  const { step, sub } = useOnboarding.getState();
  if (sub > 0) return goToStep(step, sub - 1);
  const before = stepAfter(step, -1);
  if (before && before !== "intro") goToStep(before, Math.max(0, questionsFor(before).length - 1));
}

export function chooseSource(source: BrowserSourceId | null) {
  const preset = presetFor(source);
  useOnboarding.setState({ source, preset });
  save({ source, preset });
}

export function setOnboardingDraft(patch: Partial<Settings>) {
  useOnboarding.setState((s) => ({ draft: { ...s.draft, ...patch } }));
}

export function setOnboardingExtras(patch: Partial<Extras>) {
  useOnboarding.setState((s) => ({ extras: { ...s.extras, ...patch } }));
}

export function previewLive(patch: Partial<Settings>) {
  const { windowId, baseline } = useOnboarding.getState();
  const b = useBrowser.getState();
  const recorded: LiveBaseline = { ...baseline };
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    if (key in recorded) continue;
    Object.assign(recorded, { [key]: key === "tabLayout" ? tabLayoutOf(b, windowId) : b.settings[key] });
  }
  useOnboarding.setState({ baseline: recorded });
  const { tabLayout, ...rest } = patch;
  if (tabLayout && windowId) setWindowLayout(windowId, tabLayout);
  if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
}

export function previewColor(color: ProfileColor) {
  const { windowId } = useOnboarding.getState();
  const b = useBrowser.getState();
  const profileId = windowId ? b.windows[windowId]?.profileId : undefined;
  if (!profileId) return;
  recordLookBaseline(profileId);
  b.updateProfile(profileId, { color, theme: null });
}

export function previewTheme(theme: ProfileTheme) {
  const { windowId } = useOnboarding.getState();
  const b = useBrowser.getState();
  const profileId = windowId ? b.windows[windowId]?.profileId : undefined;
  if (!profileId) return;
  recordLookBaseline(profileId);
  b.updateProfile(profileId, { theme });
}

function recordLookBaseline(profileId: string) {
  const { baseline } = useOnboarding.getState();
  if ("color" in baseline) return;
  const profile = useBrowser.getState().profiles[profileId];
  useOnboarding.setState({ baseline: { ...baseline, color: profile?.color, theme: profile?.theme ?? null } });
}

export function confirmAnswer(question: QuestionId, patch: Partial<Settings>, picked: string[]) {
  const { windowId, baseline } = useOnboarding.getState();
  if (patch.tabLayout && windowId) setWindowLayout(windowId, patch.tabLayout);
  if (Object.keys(patch).length) useBrowser.getState().updateSettings(patch);
  const kept: LiveBaseline = { ...baseline };
  for (const key of Object.keys(patch)) delete kept[key as keyof LiveBaseline];
  if (question === "color") {
    delete kept.color;
    delete kept.theme;
  }
  const all = { ...useOnboarding.getState().picked, [question]: picked };
  useOnboarding.setState({ baseline: kept, picked: all });
  save({ picked: all });
  nextStep();
}

export function skipStep() {
  const { step, sub } = useOnboarding.getState();
  const rest = questionsFor(step).slice(sub);
  const keys = rest.flatMap((q) => q.keys);
  revertLive([...keys, ...(rest.some((q) => q.id === "color") ? (["color", "theme"] as const) : [])]);
  useOnboarding.setState((s) => {
    const draft = { ...s.draft };
    for (const key of keys) delete draft[key];
    return { draft };
  });
  const after = stepAfter(step, 1);
  if (after) goToStep(after);
  else finishOnboarding();
}

function revertLive(keys: readonly (keyof LiveBaseline)[]) {
  const { windowId, baseline } = useOnboarding.getState();
  const restore = Object.fromEntries(keys.filter((k) => k in baseline).map((k) => [k, baseline[k]])) as LiveBaseline;
  if (!Object.keys(restore).length) return;
  const { color, theme, tabLayout, ...rest } = restore;
  const b = useBrowser.getState();
  const window = windowId ? b.windows[windowId] : undefined;
  if (tabLayout && windowId) setWindowLayout(windowId, tabLayout);
  if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
  if ((color || "theme" in restore) && window) b.updateProfile(window.profileId, { ...(color ? { color } : {}), ...("theme" in restore ? { theme } : {}) });
  const kept = { ...baseline };
  for (const key of keys) delete kept[key];
  useOnboarding.setState({ baseline: kept });
}

export function resolveDraft<K extends keyof Settings>(
  keys: readonly K[],
  draft: Partial<Settings>,
  preset: Preset,
  settings: Settings,
): Pick<Settings, K> {
  const presetValues = PRESETS[preset];
  const chosen = settings.chosen ?? [];
  return Object.fromEntries(
    keys.map((k) => [k, k in draft ? draft[k] : k in presetValues && !chosen.includes(k) ? presetValues[k] : settings[k]]),
  ) as Pick<Settings, K>;
}

const DOC = "onboarding.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };
type Saved = {
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

function readSaved(): Saved | null {
  try {
    return parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS) as Saved | null;
  } catch {
    return null;
  }
}

function save(patch: Partial<Saved>) {
  try {
    writeDocument(DOC, versionedJson({ completedAt: null, ...readSaved(), ...patch } satisfies Saved, DOC_VERSION));
  } catch (error) {
    console.warn("Couldn't save onboarding state", error);
  }
}

const markCompleted = () => save({ completedAt: Date.now() });

export const recordDefaultBrowserTrial = () => save({ defaultBrowserTrialStartedAt: Date.now() });

export const defaultBrowserTrialStartedAt = () => readSaved()?.defaultBrowserTrialStartedAt ?? null;

export const defaultBrowserCheckInDoneAt = () => readSaved()?.defaultBrowserCheckInDoneAt ?? null;
export const recordDefaultBrowserCheckInDone = () => save({ defaultBrowserCheckInDoneAt: Date.now() });

export const onboardingCompletedAt = () => readSaved()?.completedAt ?? null;

export const introMusicMuted = () => readSaved()?.introMusicMuted ?? false;
export const saveIntroMusicMuted = (muted: boolean) => save({ introMusicMuted: muted });

const FRESH = { preset: "dia", source: null, draft: {}, extras: {}, baseline: {}, picked: {} } satisfies Partial<OnboardingState>;

export function startOnboarding(windowId?: string | null, step: OnboardingStep = "intro") {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  endToolTour();
  useOnboarding.setState((s) => ({ ...FRESH, windowId: id, step, sub: 0, leaving: false, tourAfter: false, session: s.session + 1 }));
  save({ step, sub: 0, source: null, preset: "dia", picked: {} });
}

export const forgetOnboardingProgress = () =>
  writeDocument(DOC, versionedJson({ completedAt: null, startedAt: Date.now(), introMusicMuted: introMusicMuted() } satisfies Saved, DOC_VERSION));

function resumeOnboarding(saved: Saved) {
  const id = resolveWindowId(useBrowser.getState(), null);
  if (!id) return;
  const step = saved.step && saved.step !== "intro" && STEPS.includes(saved.step) ? saved.step : "source";
  const source = saved.source ?? null;
  useOnboarding.setState((s) => ({
    ...FRESH,
    windowId: id,
    step,
    sub: 0,
    source,
    preset: saved.preset ?? presetFor(source),
    picked: saved.picked ?? {},
    leaving: false,
    tourAfter: false,
    session: s.session + 1,
  }));
  const next = activeSteps().find((s) => STEPS.indexOf(s) >= STEPS.indexOf(step)) ?? "outro";
  if (next !== step) return goToStep(next);
  const sub = Math.min(saved.sub ?? 0, questionsFor(step).length - 1);
  if (sub > 0) useOnboarding.setState({ sub });
}

export function finishOnboarding(options: { tour?: boolean } = {}) {
  revertLive(Object.keys(useOnboarding.getState().baseline) as (keyof LiveBaseline)[]);
  markCompleted();
  stopIntroMusic(0.6);
  const { windowId } = useOnboarding.getState();
  if (windowId) useOnboarding.setState({ leaving: true, tourAfter: !!options.tour });
}

export function dismissOnboarding(session: number) {
  const { session: current, windowId, tourAfter } = useOnboarding.getState();
  if (current !== session) return;
  useOnboarding.setState({ windowId: null, step: "intro", leaving: false, tourAfter: false });
  if (tourAfter && windowId) startToolTour(windowId);
}

export function maybeStartOnboarding() {
  const saved = readSaved();
  if (saved?.completedAt) return;
  if (saved?.startedAt) return resumeOnboarding(saved);
  if (readDocument("session.json")) return markCompleted();
  if (__DEV__ && devTestValue("onboarding") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}
