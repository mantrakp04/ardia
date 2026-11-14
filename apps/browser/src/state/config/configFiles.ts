import { configDirectory } from "../../platform/launchConfig";
import { onConfigChange, readConfigFile, watchConfigFiles, writeConfigSchemas, type ConfigFileRead } from "../../platform/configFolder";
import { afterFirstWindow } from "../../lib/afterFirstWindow";
import { mergedPalettes, parseThemeFile, type RolePalettes, type ThemeRoles } from "../../lib/themeFile";
import { DEFAULT_LOOK, resolveLook, type LookBlocks } from "../../lib/themeLook";
import { setActiveLook } from "../../lib/activeLook";
import { useBrowser } from "../browser/store";
import { showToast } from "../app/toasts";
import { focusedWindowOf } from "../windows/ui";
import { useBasePalette } from "./basePalette";
import { CONFIG_FILE, launchRestoreSession, readConfig } from "./configSettings";
import { schemaFiles } from "./configSchema";
import { reloadHooks } from "../automation/hookRules";

const RECONCILE_DELAY_MS = 100;

const READ_PROBLEMS: Record<Exclude<ConfigFileRead["status"], "ok" | "missing">, string> = {
  notFile: "isn't a regular file",
  tooBig: "is over 1 MB",
  unreadable: "can't be read",
};

type ThemeParts = { roles: ThemeRoles | null; look: LookBlocks | null };
type Theme = ThemeParts & { name: string | null };

const NO_THEME: ThemeParts = { roles: null, look: null };

let defaults: RolePalettes | null = null;
let theme: Theme = { name: null, ...NO_THEME };
let revision = 0;
let windowsUp = false;
let reported = new Set<string>();
let unshown: string[] = [];
let watching: string | null | undefined;
let schemas: Record<string, string> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const lastGoodThemes = new Map<string, ThemeParts>();

const themeFile = (name: string) => `themes/${name}.json`;

function readTheme(name: string | null, problems: string[]): ThemeParts {
  if (!name || !defaults) return NO_THEME;
  const file = themeFile(name);
  const read = readConfigFile(file);
  if (read.status === "missing") {
    problems.push(`${CONFIG_FILE}: theme ${name} has no file ${file}`);
    return NO_THEME;
  }
  if (read.status !== "ok") {
    problems.push(`${file}: ${READ_PROBLEMS[read.status]}`);
    return lastGoodThemes.get(name) ?? NO_THEME;
  }
  const parsed = parseThemeFile(file, read.text, defaults);
  problems.push(...parsed.problems);
  if (!parsed.roles) return lastGoodThemes.get(name) ?? NO_THEME;
  const parts = { roles: parsed.roles, look: parsed.look };
  lastGoodThemes.set(name, parts);
  return parts;
}

function applySidebarWidth(before: number | null, after: number | null) {
  if (!windowsUp || after === null || after === before) return;
  const width = Math.round(after);
  if (useBrowser.getState().settings.sidebarWidth !== width) useBrowser.getState().updateSettings({ sidebarWidth: width });
}

function applyTheme(next: Theme) {
  if (!defaults) return;
  if (next.name === theme.name && JSON.stringify([next.roles, next.look]) === JSON.stringify([theme.roles, theme.look])) return;
  const before = useBasePalette.getState().look;
  const look = resolveLook(next.look);
  theme = next;
  revision += 1;
  setActiveLook(look);
  const themed = next.roles || look !== DEFAULT_LOOK;
  useBasePalette.setState({ palette: themed ? mergedPalettes(defaults, next.roles, revision) : null, theme: next.name, look, blocks: next.look });
  applySidebarWidth(before.sidebarWidth, look.sidebarWidth);
}

function showProblems() {
  const windowId = focusedWindowOf(useBrowser.getState()) ?? useBrowser.getState().windowOrder[0];
  if (!windowsUp || !windowId || !unshown.length) return;
  const [first, ...rest] = unshown;
  unshown = [];
  const more = rest.length ? `${rest.length === 1 ? "1 more problem" : `${rest.length} more problems`}: ${rest.join("; ")}` : undefined;
  showToast(windowId, first!, more, { icon: "exclamationmark.triangle" });
}

function report(problems: string[]) {
  const now = new Set(problems);
  const fresh = [...now].filter((p) => !reported.has(p));
  reported = now;
  if (!fresh.length) return;
  for (const problem of fresh) console.warn(`[config] ${problem} (${configDirectory()})`);
  unshown = [...unshown.filter((p) => now.has(p)), ...fresh];
  showProblems();
}

function watchNames() {
  if (theme.name === watching) return;
  watching = theme.name;
  watchConfigFiles(["config.json", "hooks.json", ...(theme.name ? [themeFile(theme.name)] : [])]).then(changed, (error: unknown) => console.warn("[config] couldn't watch the config folder", error));
}

export function reconcileConfig() {
  const problems: string[] = [];
  const read = readConfigFile(CONFIG_FILE);
  let name = theme.name;
  if (read.status === "missing") name = null;
  else if (read.status !== "ok") problems.push(`${CONFIG_FILE}: ${READ_PROBLEMS[read.status]}`);
  else {
    const config = readConfig(read.text, useBrowser.getState().settings);
    problems.push(...config.problems);
    if (Object.keys(config.patch).length) useBrowser.getState().updateSettings(config.patch);
    if (config.theme !== undefined) name = config.theme;
  }
  applyTheme({ name, ...readTheme(name, problems) });
  report(problems);
  if (watching !== undefined) watchNames();
}

function writeSchemas() {
  if (!defaults) return;
  schemas ??= schemaFiles(defaults);
  writeConfigSchemas(schemas).catch((error: unknown) => console.warn("[config] couldn't write the schemas", error));
}

function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    reconcileConfig();
    reloadHooks();
    writeSchemas();
  }, RECONCILE_DELAY_MS);
}

export function configRestoreSession(): boolean | undefined {
  const read = readConfigFile(CONFIG_FILE);
  return read.status === "ok" ? launchRestoreSession(read.text, useBrowser.getState().settings) : undefined;
}

export function startConfigFiles(roles: RolePalettes) {
  if (defaults) return;
  defaults = roles;
  reconcileConfig();
  afterFirstWindow(() => {
    windowsUp = true;
    onConfigChange(changed);
    watchNames();
    writeSchemas();
    showProblems();
  });
}

export function resetConfigFilesForTests() {
  clearTimeout(timer);
  timer = undefined;
  defaults = null;
  theme = { name: null, ...NO_THEME };
  windowsUp = false;
  reported = new Set();
  unshown = [];
  watching = undefined;
  schemas = null;
  lastGoodThemes.clear();
  setActiveLook(DEFAULT_LOOK);
  useBasePalette.setState({ palette: null, theme: null, look: DEFAULT_LOOK, blocks: null });
}
