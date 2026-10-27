import type { ProfileColor } from "../browser/types";
import type { Preset } from "../onboarding/onboarding";
import type { Settings } from "../settings/settings";

export const SETUP_CODE_VERSION = 1;
export const SETUP_CODE_PREFIX = `ardia${SETUP_CODE_VERSION}-`;
export const SETUP_CODE_MAX_LENGTH = 160;
export const SETUP_CODE_MAX_INPUT = SETUP_CODE_MAX_LENGTH * 8;

export const SETUP_SETTING_KEYS = [
  "tabLayout",
  "addressBar",
  "commandBarPlacement",
  "newTabOpens",
  "newTabPosition",
  "newTabButtonPosition",
  "cleanUpInactiveTabsAfterHours",
  "restoreSession",
  "shareTabsAcrossWindows",
  "balancedTopApps",
  "peekModifier",
  "undoReopensClosedTab",
  "cmdClickCreatesTabGroup",
  "appearance",
  "extendWebsiteColor",
  "hideToolbarWhileScrolling",
  "bookmarksBar",
] as const;

export type SetupSettingKey = (typeof SETUP_SETTING_KEYS)[number];

export type SetupChoices = {
  preset?: Preset;
  settings: Partial<Pick<Settings, SetupSettingKey>>;
  color?: ProfileColor;
  pins?: string[];
};

export type SetupCodeResult = { ok: true; choices: SetupChoices } | { ok: false; error: string };

type Field<T> = { key: string; values: readonly T[] };

const BOOL = [false, true] as const;

const SETTING_FIELDS: { [K in SetupSettingKey]: Field<Settings[K]> } = {
  tabLayout: { key: "t", values: ["sidebar", "top"] },
  addressBar: { key: "a", values: ["toolbar", "sidebar"] },
  commandBarPlacement: { key: "c", values: ["field", "centred"] },
  newTabOpens: { key: "n", values: ["page", "commandBar"] },
  newTabPosition: { key: "o", values: ["top", "bottom", "nextToCurrent"] },
  newTabButtonPosition: { key: "b", values: ["top", "bottom"] },
  cleanUpInactiveTabsAfterHours: { key: "i", values: [null, 12, 24, 168] },
  restoreSession: { key: "r", values: BOOL },
  shareTabsAcrossWindows: { key: "w", values: BOOL },
  balancedTopApps: { key: "g", values: BOOL },
  peekModifier: { key: "k", values: ["alt", "shift", "off"] },
  undoReopensClosedTab: { key: "u", values: BOOL },
  cmdClickCreatesTabGroup: { key: "m", values: BOOL },
  appearance: { key: "e", values: ["auto", "light", "dark"] },
  extendWebsiteColor: { key: "s", values: BOOL },
  hideToolbarWhileScrolling: { key: "h", values: BOOL },
  bookmarksBar: { key: "v", values: ["always", "newTab", "never"] },
};

const PRESET_FIELD: Field<Preset> = { key: "p", values: ["arc", "dia", "chrome", "safari", "firefox", "zen", "brave", "edge", "fresh"] };
const COLOR_FIELD: Field<ProfileColor> = { key: "x", values: ["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral"] };
const PINS_KEY = "f";

export const SETUP_PIN_SITES = ["gmail", "calendar", "slack", "notion", "figma", "github", "linear", "docs", "drive", "outlook", "youtube", "spotify"] as const;

const ENTRY = /([a-z])(\d{1,9})/y;
const MAX_ENUM_DIGITS = 2;
const MAX_MASK_DIGITS = 9;
const CHECK_DIGITS = 2;
const CHECK_SPACE = 36 ** CHECK_DIGITS;

export const SETUP_CODE_ERRORS = {
  empty: "Paste a setup code first.",
  shape: `That doesn't look like a setup code. It starts with ${SETUP_CODE_PREFIX}`,
  newer: "That code is from a newer Ardia. Update Ardia, then paste it again.",
  damaged: "That code looks cut off or mistyped. Copy it again from ardia.dev.",
  nothing: "That code has nothing this version of Ardia can apply.",
} as const;

function checksum(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % CHECK_SPACE).toString(36).padStart(CHECK_DIGITS, "0");
}

function indexOf<T>(field: Field<T>, value: T | undefined): number {
  return value === undefined ? -1 : field.values.indexOf(value);
}

function pinMask(pins: readonly string[]): number {
  let mask = 0;
  SETUP_PIN_SITES.forEach((id, bit) => {
    if (pins.includes(id)) mask |= 1 << bit;
  });
  return mask;
}

function pinsOf(mask: number): string[] {
  return SETUP_PIN_SITES.filter((_, bit) => mask & (1 << bit));
}

export function encodeSetupCode(choices: SetupChoices): string {
  const entries: string[] = [];
  const put = <T>(field: Field<T>, value: T | undefined) => {
    const index = indexOf(field, value);
    if (index >= 0) entries.push(`${field.key}${index}`);
  };
  put(PRESET_FIELD, choices.preset);
  for (const key of SETUP_SETTING_KEYS) put(SETTING_FIELDS[key] as Field<unknown>, choices.settings[key]);
  put(COLOR_FIELD, choices.color);
  if (choices.pins) entries.push(`${PINS_KEY}${pinMask(choices.pins)}`);
  const body = entries.join("");
  return `${SETUP_CODE_PREFIX}${body}-${checksum(body)}`;
}

function parseEntries(body: string): Map<string, string> | null {
  const entries = new Map<string, string>();
  ENTRY.lastIndex = 0;
  while (ENTRY.lastIndex < body.length) {
    const match = ENTRY.exec(body);
    if (!match) return null;
    const [, key, digits] = match;
    if (entries.has(key!)) return null;
    entries.set(key!, digits!);
  }
  return entries;
}

export function normalizeSetupCode(input: string): string {
  return input.replace(/\s+/g, "").toLowerCase();
}

export function decodeSetupCode(input: string): SetupCodeResult {
  if (input.length > SETUP_CODE_MAX_INPUT) return { ok: false, error: SETUP_CODE_ERRORS.shape };
  const code = normalizeSetupCode(input);
  if (!code) return { ok: false, error: SETUP_CODE_ERRORS.empty };
  if (code.length > SETUP_CODE_MAX_LENGTH) return { ok: false, error: SETUP_CODE_ERRORS.shape };
  const version = /^ardia(\d{1,3})-/.exec(code);
  if (!version) return { ok: false, error: SETUP_CODE_ERRORS.shape };
  if (Number(version[1]) > SETUP_CODE_VERSION) return { ok: false, error: SETUP_CODE_ERRORS.newer };
  if (version[0] !== SETUP_CODE_PREFIX) return { ok: false, error: SETUP_CODE_ERRORS.shape };
  const rest = code.slice(SETUP_CODE_PREFIX.length);
  const dash = rest.lastIndexOf("-");
  if (dash < 0 || rest.length - dash - 1 !== CHECK_DIGITS) return { ok: false, error: SETUP_CODE_ERRORS.damaged };
  const body = rest.slice(0, dash);
  if (checksum(body) !== rest.slice(dash + 1)) return { ok: false, error: SETUP_CODE_ERRORS.damaged };
  const entries = parseEntries(body);
  if (!entries) return { ok: false, error: SETUP_CODE_ERRORS.damaged };

  const numberAt = (key: string, maxDigits: number) => {
    const digits = entries.get(key);
    if (digits === undefined || digits.length > maxDigits || String(Number(digits)) !== digits) return undefined;
    return Number(digits);
  };
  const read = <T>(field: Field<T>): T | undefined => {
    const index = numberAt(field.key, MAX_ENUM_DIGITS);
    return index !== undefined && index < field.values.length ? field.values[index] : undefined;
  };
  const settings: Partial<Record<SetupSettingKey, unknown>> = {};
  for (const key of SETUP_SETTING_KEYS) {
    const value = read(SETTING_FIELDS[key] as Field<unknown>);
    if (value !== undefined) settings[key] = value;
  }
  const choices: SetupChoices = { settings: settings as SetupChoices["settings"] };
  const preset = read(PRESET_FIELD);
  if (preset) choices.preset = preset;
  const color = read(COLOR_FIELD);
  if (color) choices.color = color;
  const mask = numberAt(PINS_KEY, MAX_MASK_DIGITS);
  if (mask !== undefined) choices.pins = pinsOf(mask);
  if (!Object.keys(settings).length && !preset && !color && !choices.pins) return { ok: false, error: SETUP_CODE_ERRORS.nothing };
  return { ok: true, choices };
}

const APPEARANCE_LINE = { auto: "Appearance follows your Mac", light: "Always light", dark: "Always dark" } as const;

export function describeSetupChoices(choices: SetupChoices): string[] {
  const s = choices.settings;
  const lines: string[] = [];
  if (s.tabLayout) lines.push(s.tabLayout === "top" ? "Tabs along the top" : "Tabs in the sidebar");
  if (s.addressBar && s.tabLayout !== "top") lines.push(s.addressBar === "sidebar" ? "Address in the sidebar" : "Address in the toolbar");
  if (s.newTabOpens) lines.push(s.newTabOpens === "commandBar" ? "⌘T opens the command bar" : "⌘T opens the New Tab page");
  if (s.appearance) lines.push(APPEARANCE_LINE[s.appearance]);
  if (choices.color) lines.push(`${choices.color[0]!.toUpperCase()}${choices.color.slice(1)} theme`);
  if (choices.pins?.length) lines.push(`${choices.pins.length} ${choices.pins.length === 1 ? "app" : "apps"} pinned`);
  return lines;
}
