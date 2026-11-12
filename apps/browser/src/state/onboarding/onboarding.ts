import { stopIntroMusic } from "../../platform/introMusic";
import { devTestValue } from "../../platform/launchConfig";
import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { resolveWindowId, tabLayoutOf } from "../browser/model";
import type { Settings } from "../settings/settings";
import type { ProfileColor, ProfileTheme } from "../browser/types";
import { PRESETS, presetFor, setsUpLikeBrowser, type BrowserSourceId, type Preset } from "./presets";
import { endToolTour, startToolTour } from "./tour";
import { choosePresetColor, setProfileTheme } from "../profiles/themeActions";
import { stepsForThisSurface } from "./demoSteps";
import { hasSavedSession } from "../session/sessionDocument";
import { isLiquidGlass } from "../../platform/app";
import { noteOnboarding } from "../telemetry/usage";
import { openSettings } from "../settings/settingsWindows";

import { GLASS_KEYS, QUESTIONS, QUESTION_ORDER, type OnboardingStep, type Question, type QuestionId } from "./questionList";
import { markCompleted, readSaved, saveOnboarding as save, type Saved } from "./onboardingDocument";

export { GLASS_KEYS, QUESTIONS, QUESTION_ORDER, type OnboardingStep, type QuestionId };
export {
  defaultBrowserCheckInDoneAt,
  defaultBrowserTrialStartedAt,
  forgetOnboardingProgress,
  introMusicMuted,
  onboardingCompletedAt,
  recordDefaultBrowserCheckInDone,
  recordDefaultBrowserTrial,
  saveIntroMusicMuted,
} from "./onboardingDocument";
export { playIntroMusic, setIntroMusicMuted, stopIntroMusic, type IntroMusicCues } from "../../platform/introMusic";
export { PRESET_NAMES, PRESETS, presetFor, setsUpLikeBrowser, type BrowserSourceId, type Preset } from "./presets";

export const STEPS: OnboardingStep[] = stepsForThisSurface(["intro", "source", "look", "layout", "tabs", "details", "searchPrivacy", "pins", "home", "outro"]);

export const CUSTOMIZE_STEPS: readonly OnboardingStep[] = ["layout", "tabs", "details", "searchPrivacy", "pins", "home"];

const SIDEBAR_ONLY: readonly QuestionId[] = ["address", "switcher"];
export const liquidGlass = isLiquidGlass();

export function questionsFor(step: OnboardingStep): Question[] {
  if (step === "intro") return [];
  const state = useOnboarding.getState();
  const list = QUESTIONS[step];
  if (!list.some((q) => SIDEBAR_ONLY.includes(q.id))) return list;
  const b = useBrowser.getState();
  const { tabLayout } = resolveDraft(["tabLayout"], state.draft, draftPreset(state), { ...b.settings, tabLayout: tabLayoutOf(b, state.windowId) }, b.settingsMeta.chosen);
  return tabLayout === "top" ? list.filter((q) => !SIDEBAR_ONLY.includes(q.id)) : list;
}

export const activeSteps = () => {
  const { customizing } = useOnboarding.getState();
  return STEPS.filter((step) => step === "intro" || ((customizing || !CUSTOMIZE_STEPS.includes(step)) && questionsFor(step).length > 0));
};

export const draftPreset = (s: { prefill: Prefill; preset: Preset }): Preset | null => (s.prefill === "preset" ? s.preset : null);

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

type Prefill = "preset" | "current";

type OnboardingState = {
  windowId: string | null;
  step: OnboardingStep;
  sub: number;
  leaving: boolean;
  session: number;
  tourAfter: boolean;
  redo: boolean;
  redoSource: BrowserSourceId | null;
  prefill: Prefill;
  customizing: boolean;
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
  redo: false,
  redoSource: null,
  prefill: "preset",
  customizing: false,
  preset: "dia",
  source: null,
  draft: {},
  extras: {},
  baseline: {},
  picked: {},
}));

export function goToStep(step: OnboardingStep, sub = 0) {
  useOnboarding.setState({ step, sub });
  if (!useOnboarding.getState().redo) save({ step, sub });
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
  const { redo, redoSource } = useOnboarding.getState();
  useOnboarding.setState({ source, preset, prefill: redo && source === redoSource ? "current" : "preset" });
  if (!redo) save({ source, preset });
}

export const sourcePatch = (): Partial<Settings> => {
  const { source, prefill } = useOnboarding.getState();
  return prefill === "preset" ? presetPatch(source) : {};
};

export function customizeMore() {
  noteOnboarding("customizeMore");
  useOnboarding.setState({ customizing: true });
  const first = activeSteps().find((step) => CUSTOMIZE_STEPS.includes(step));
  if (first) goToStep(first);
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
  choosePresetColor(profileId, color);
}

export function previewTheme(theme: ProfileTheme) {
  const { windowId } = useOnboarding.getState();
  const b = useBrowser.getState();
  const profileId = windowId ? b.windows[windowId]?.profileId : undefined;
  if (!profileId) return;
  recordLookBaseline(profileId);
  setProfileTheme(profileId, theme);
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
  if (question === "look") {
    delete kept.color;
    delete kept.theme;
  }
  const all = { ...useOnboarding.getState().picked, [question]: picked };
  useOnboarding.setState({ baseline: kept, picked: all });
  if (!useOnboarding.getState().redo) save({ picked: all });
  if (question !== "outro") noteOnboarding("stepCompleted");
  nextStep();
}

export function skipStep() {
  const { step, sub } = useOnboarding.getState();
  const rest = questionsFor(step).slice(sub);
  const keys = rest.flatMap((q) => q.keys);
  noteOnboarding("stepSkipped");
  revertLive([...keys, ...(rest.some((q) => q.id === "look") ? (["color", "theme"] as const) : [])]);
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
  if ((color || "theme" in restore) && window) b.setProfileLook(window.profileId, { ...(color ? { color } : {}), ...("theme" in restore ? { theme } : {}) });
  const kept = { ...baseline };
  for (const key of keys) delete kept[key];
  useOnboarding.setState({ baseline: kept });
}

export function resolveDraft<K extends keyof Settings>(
  keys: readonly K[],
  draft: Partial<Settings>,
  preset: Preset | null,
  settings: Settings,
  chosen: readonly string[],
): Pick<Settings, K> {
  const presetValues: Partial<Settings> = preset ? PRESETS[preset] : {};
  return Object.fromEntries(
    keys.map((k) => [k, k in draft ? draft[k] : k in presetValues && !chosen.includes(k) ? presetValues[k] : settings[k]]),
  ) as Pick<Settings, K>;
}

const FRESH = {
  preset: "dia",
  source: null,
  draft: {},
  extras: {},
  baseline: {},
  picked: {},
  redo: false,
  redoSource: null,
  prefill: "preset",
  customizing: false,
} satisfies Partial<OnboardingState>;

export function startOnboarding(windowId?: string | null, step: OnboardingStep = "intro") {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  endToolTour();
  useOnboarding.setState((s) => ({ ...FRESH, windowId: id, step, sub: 0, leaving: false, tourAfter: false, session: s.session + 1 }));
  save({ step, sub: 0, source: null, preset: "dia", picked: {} });
}

export function redoOnboarding(windowId?: string | null) {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id || useOnboarding.getState().windowId) return null;
  endToolTour();
  const saved = readSaved();
  const source = saved?.source ?? null;
  useOnboarding.setState((s) => ({
    ...FRESH,
    windowId: id,
    step: "source",
    sub: 0,
    leaving: false,
    tourAfter: false,
    session: s.session + 1,
    redo: true,
    redoSource: source,
    source,
    preset: saved?.preset ?? presetFor(source),
    prefill: "current",
  }));
  noteOnboarding("redoOpened");
  return id;
}

export function cancelOnboarding() {
  const { windowId, redo } = useOnboarding.getState();
  if (!windowId || !redo) return;
  revertLive(Object.keys(useOnboarding.getState().baseline) as (keyof LiveBaseline)[]);
  noteOnboarding("redoCancelled");
  useOnboarding.setState({ leaving: true, tourAfter: false });
}

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
  const { redo, source } = useOnboarding.getState();
  if (redo) {
    noteOnboarding("redoCompleted");
    save({ source, preset: presetFor(source) });
  } else markCompleted();
  stopIntroMusic(0.6);
  const { windowId } = useOnboarding.getState();
  if (windowId) useOnboarding.setState({ leaving: true, tourAfter: !!options.tour });
}

export function dismissOnboarding(session: number) {
  const { session: current, windowId, tourAfter, redo } = useOnboarding.getState();
  if (current !== session) return;
  useOnboarding.setState({ windowId: null, step: "intro", leaving: false, tourAfter: false, redo: false, customizing: false });
  if (tourAfter && windowId) startToolTour(windowId);
  else if (redo) openSettings("general");
}

export function maybeStartOnboarding() {
  const saved = readSaved();
  if (saved?.completedAt) return;
  if (saved?.startedAt) return resumeOnboarding(saved);
  if (hasSavedSession()) return markCompleted();
  if (__DEV__ && devTestValue("onboarding") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}
