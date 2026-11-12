import type { Settings } from "../settings/settings";

export type OnboardingStep = "intro" | "source" | "look" | "layout" | "tabs" | "details" | "searchPrivacy" | "pins" | "home" | "outro";

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
  | "look"
  | "switcher" | "frame" | "siteColor" | "lookMore"
  | "engine"
  | "typed"
  | "pins"
  | "links"
  | "outro";

export type Question = { id: QuestionId; keys: readonly (keyof Settings)[] };

export const GLASS_KEYS = ["interfaceStyle", "glassTintWithTheme", "glassTintAmount"] as const satisfies readonly (keyof Settings)[];

export const QUESTIONS: Record<Exclude<OnboardingStep, "intro">, Question[]> = {
  source: [{ id: "source", keys: [] }],
  look: [{ id: "look", keys: ["appearance", ...GLASS_KEYS] }],
  layout: [
    { id: "tabs", keys: ["tabLayout"] },
    { id: "address", keys: ["addressBar"] },
    { id: "cmdl", keys: ["commandBarPlacement"] },
  ],
  tabs: [
    { id: "newTab", keys: ["newTabOpens"] },
    { id: "newTabPosition", keys: ["newTabPosition", "newTabButtonPosition"] },
    { id: "tidy", keys: ["cleanUpInactiveTabsAfterMinutes"] },
    { id: "quit", keys: ["restoreSession"] },
    { id: "windows", keys: ["shareTabsAcrossWindows"] },
    { id: "tabsMore", keys: ["balancedTopApps", "peekModifier", "undoReopensClosedTab", "cmdClickCreatesTabGroup"] },
  ],
  details: [
    { id: "switcher", keys: ["profileSwitcherIcons"] },
    { id: "frame", keys: ["pageFrame", "borderlessMode"] },
    { id: "siteColor", keys: ["extendWebsiteColor"] },
    { id: "lookMore", keys: ["hideToolbarWhileScrolling", "bookmarksBar"] },
  ],
  searchPrivacy: [
    { id: "engine", keys: ["searchEngine"] },
    { id: "typed", keys: ["commandBarPreference"] },
  ],
  pins: [{ id: "pins", keys: [] }],
  home: [{ id: "links", keys: ["openLinksInLittleArdia"] }],
  outro: [{ id: "outro", keys: [] }],
};

export const QUESTION_ORDER: QuestionId[] = Object.values(QUESTIONS).flatMap((list) => list.map((q) => q.id));
