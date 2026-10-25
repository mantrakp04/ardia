import { launchEnvironment, readDocument, stopIntroMusic, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { resolveWindowId, tabLayoutOf } from "../../store/model";
import type { Settings } from "../../store/settings";
import type { ProfileColor } from "../../store/types";
import { pinSites } from "./sites";
import { endToolTour, startToolTour } from "./tour/state";

export type OnboardingStep = "intro" | "source" | "layout" | "tabs" | "look" | "searchPrivacy" | "pins" | "home" | "outro";

export const STEPS: OnboardingStep[] = ["intro", "source", "layout", "tabs", "look", "searchPrivacy", "pins", "home", "outro"];

export type Preset = "arc" | "dia";

export type BrowserSourceId = "arc" | "dia" | "chrome" | "safari" | "firefox" | "brave" | "edge" | "fresh";

export const PRESETS: Record<Preset, Partial<Settings>> = {
  dia: {
    addressBar: "toolbar",
    commandBarPlacement: "field",
    newTabOpens: "page",
    newTabPosition: "bottom",
    balancedTopApps: false,
    shareTabsAcrossWindows: false,
    cleanUpInactiveTabsAfterHours: null,
    openLinksInLittleArdia: true,
  },
  arc: {
    addressBar: "sidebar",
    commandBarPlacement: "centred",
    newTabOpens: "commandBar",
    newTabPosition: "top",
    balancedTopApps: true,
    shareTabsAcrossWindows: true,
    cleanUpInactiveTabsAfterHours: 12,
    openLinksInLittleArdia: true,
  },
};

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
    { id: "newTabPosition", keys: ["newTabPosition"] },
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

export function questionsFor(step: OnboardingStep): Question[] {
  if (step === "intro") return [];
  const list = QUESTIONS[step];
  if (step !== "layout") return list;
  const { windowId, draft, preset } = useOnboarding.getState();
  const b = useBrowser.getState();
  const { tabLayout } = resolveDraft(["tabLayout"], draft, preset, { ...b.settings, tabLayout: tabLayoutOf(b, windowId) });
  return tabLayout === "top" ? list.filter((q) => q.id !== "address") : list;
}

export const presetFor = (source: BrowserSourceId | null): Preset => (source === "arc" ? "arc" : "dia");

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

type LiveBaseline = Partial<Settings> & { color?: ProfileColor };

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
  go(step: OnboardingStep, sub?: number): void;
  next(): void;
  back(): void;
  chooseSource(source: BrowserSourceId | null): void;
  setDraft(patch: Partial<Settings>): void;
  setExtras(patch: Partial<Extras>): void;
  previewLive(patch: Partial<Settings>): void;
  previewColor(color: ProfileColor): void;
  confirm(question: QuestionId, patch: Partial<Settings>, picked: string[]): void;
  skip(): void;
};

const stepAfter = (step: OnboardingStep, delta: number) => STEPS[STEPS.indexOf(step) + delta];

const setWindowLayout = (windowId: string, tabLayout: Settings["tabLayout"]) =>
  useBrowser.setState((s) => {
    const w = s.windows[windowId];
    return w && w.tabLayout !== tabLayout ? { windows: { ...s.windows, [windowId]: { ...w, tabLayout } } } : {};
  });

export const useOnboarding = create<OnboardingState>((set, get) => ({
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
  go(step, sub = 0) {
    set({ step, sub });
    save({ step, sub });
  },
  next() {
    const { step, sub } = get();
    if (sub < questionsFor(step).length - 1) return get().go(step, sub + 1);
    const after = stepAfter(step, 1);
    if (after) get().go(after);
    else finishOnboarding();
  },
  back() {
    const { step, sub } = get();
    if (sub > 0) return get().go(step, sub - 1);
    const before = stepAfter(step, -1);
    if (before && before !== "intro") get().go(before, Math.max(0, questionsFor(before).length - 1));
  },
  chooseSource(source) {
    const preset = presetFor(source);
    set({ source, preset });
    save({ source, preset });
  },
  setDraft(patch) {
    set((s) => ({ draft: { ...s.draft, ...patch } }));
  },
  setExtras(patch) {
    set((s) => ({ extras: { ...s.extras, ...patch } }));
  },
  previewLive(patch) {
    const { windowId, baseline } = get();
    const b = useBrowser.getState();
    const recorded: LiveBaseline = { ...baseline };
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      if (key in recorded) continue;
      Object.assign(recorded, { [key]: key === "tabLayout" ? tabLayoutOf(b, windowId) : b.settings[key] });
    }
    set({ baseline: recorded });
    const { tabLayout, ...rest } = patch;
    if (tabLayout && windowId) setWindowLayout(windowId, tabLayout);
    if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
  },
  previewColor(color) {
    const { windowId, baseline } = get();
    const b = useBrowser.getState();
    const profileId = windowId ? b.windows[windowId]?.profileId : undefined;
    if (!profileId) return;
    if (!("color" in baseline)) set({ baseline: { ...baseline, color: b.profiles[profileId]?.color } });
    b.updateProfile(profileId, { color });
  },
  confirm(question, patch, picked) {
    const { windowId, baseline } = get();
    if (patch.tabLayout && windowId) setWindowLayout(windowId, patch.tabLayout);
    if (Object.keys(patch).length) useBrowser.getState().updateSettings(patch);
    const kept: LiveBaseline = { ...baseline };
    for (const key of Object.keys(patch)) delete kept[key as keyof LiveBaseline];
    if (question === "color") delete kept.color;
    const all = { ...get().picked, [question]: picked };
    set({ baseline: kept, picked: all });
    save({ picked: all });
    get().next();
  },
  skip() {
    const { step, sub } = get();
    const rest = questionsFor(step).slice(sub);
    const keys = rest.flatMap((q) => q.keys);
    revertLive([...keys, ...(rest.some((q) => q.id === "color") ? (["color"] as const) : [])]);
    set((s) => {
      const draft = { ...s.draft };
      for (const key of keys) delete draft[key];
      return { draft };
    });
    const after = stepAfter(step, 1);
    if (after) get().go(after);
    else finishOnboarding();
  },
}));

function revertLive(keys: readonly (keyof LiveBaseline)[]) {
  const { windowId, baseline } = useOnboarding.getState();
  const restore = Object.fromEntries(keys.filter((k) => k in baseline).map((k) => [k, baseline[k]])) as LiveBaseline;
  if (!Object.keys(restore).length) return;
  const { color, tabLayout, ...rest } = restore;
  const b = useBrowser.getState();
  const window = windowId ? b.windows[windowId] : undefined;
  if (tabLayout && windowId) setWindowLayout(windowId, tabLayout);
  if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
  if (color && window) b.updateProfile(window.profileId, { color });
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
type Saved = {
  version: 1;
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
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Saved) : null;
  } catch {
    return null;
  }
}

function save(patch: Partial<Saved>) {
  try {
    writeDocument(DOC, JSON.stringify({ version: 1, completedAt: null, ...readSaved(), ...patch } satisfies Saved));
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

function resumeOnboarding(saved: Saved) {
  const id = resolveWindowId(useBrowser.getState(), null);
  if (!id) return;
  const step = saved.step && STEPS.includes(saved.step) && saved.step !== "intro" ? saved.step : "source";
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
  if (__DEV__ && launchEnvironment("ARDIA_ONBOARDING") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}

if (__DEV__) (globalThis as { acOnboarding?: unknown }).acOnboarding = {
    store: useOnboarding,
    start: startOnboarding,
    finish: finishOnboarding,
    pinSites,
    resolveDraft,
    questionsFor,
    PRESETS,
  };
