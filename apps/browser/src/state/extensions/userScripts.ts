import { installExtension, listExtensions, reloadExtension, uninstallExtension, type InstalledExtension } from "../../platform/extensions";
import {
  onUserScriptsChange,
  readUserScripts,
  readUserScriptsStatus,
  userScriptsAvailable,
  watchUserScripts,
  writeUserScriptsStatus,
  type UserScriptsFolder,
} from "../../platform/userScripts";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

export type ScriptsOutcome = { ok: true } | { disabled: true } | { removed: true } | { error: string };
type Status = { generation: number; profiles: Record<string, ScriptsOutcome> };

const enabled = () => useBrowser.getState().settings.cliControl ?? false;

export function scriptsTargets(s: Pick<BrowserState, "profileOrder" | "profiles">): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  const taken = new Map<string, number>();
  for (const id of s.profileOrder) {
    const profile = s.profiles[id];
    if (!profile || isIncognitoProfile(id)) continue;
    const base = profile.name.trim() || id;
    const seen = (taken.get(base) ?? 0) + 1;
    taken.set(base, seen);
    const name = seen === 1 ? base : `${base} (${seen})`;
    const engine = engineProfile(id);
    targets.set(engine, [...(targets.get(engine) ?? []), name]);
  }
  return targets;
}

const targetsKey = (targets: Map<string, string[]>) => JSON.stringify([...targets]);

const withoutPrivate = (path: string) => path.replace(/^\/private(?=\/(tmp|var|etc)\/)/, "");
const loadedFrom = (ext: InstalledExtension, path: string) => !!ext.path && withoutPrivate(ext.path) === withoutPrivate(path);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const BLOCKED = "Ardia Scripts can only hold content scripts, and the engine blocked this copy.";

async function load(profile: string, path: string): Promise<ScriptsOutcome> {
  try {
    const find = async (match: (x: InstalledExtension) => boolean) => (await listExtensions(profile)).find(match);
    const existing = await find((x) => loadedFrom(x, path));
    if (existing && !existing.enabled && !existing.blockedByPolicy) {
      await reloadExtension(existing.id, profile);
      return { disabled: true };
    }
    const id = await installExtension({ path }, profile);
    const loaded = await find((x) => x.id === id);
    if (!loaded) return { error: "The extension didn't load." };
    if (loaded.enabled) return { ok: true };
    if (loaded.blockedByPolicy) return { error: loaded.errors[0] ?? BLOCKED };
    return loaded.state === "DISABLED" ? { disabled: true } : { error: `The extension is ${loaded.state.toLowerCase()}.` };
  } catch (error) {
    return { error: message(error) };
  }
}

async function unload(profile: string, path: string): Promise<ScriptsOutcome> {
  try {
    for (const ext of (await listExtensions(profile)).filter((x) => loadedFrom(x, path))) await uninstallExtension(ext.id, profile);
    return { removed: true };
  } catch (error) {
    return { error: message(error) };
  }
}

const withError = (unloaded: ScriptsOutcome, refused: string): ScriptsOutcome =>
  "error" in unloaded ? { error: `${refused} (and the loaded copy couldn't be removed: ${unloaded.error})` } : { error: refused };

type Wanted = "present" | "absent";
const wantedBy = (outcome: ScriptsOutcome): Wanted => ("removed" in outcome ? "absent" : "present");
const applied = new Map<string, { generation: number; wanted: Wanted; outcome: ScriptsOutcome }>();
let seeded = false;
let lastStatus: string | null = null;
const STATUS_VERSION = 1;
const STATUS_MIGRATIONS: Migrations = { 0: unchanged };

let running: Promise<void> | null = null;
let again = false;

async function seed() {
  if (seeded) return;
  seeded = true;
  try {
    lastStatus = await readUserScriptsStatus();
    const status = parseSaved(lastStatus, STATUS_VERSION, STATUS_MIGRATIONS) as Status | null;
    if (!status || typeof status.generation !== "number" || !status.profiles) return;
    for (const [engine, names] of scriptsTargets(useBrowser.getState())) {
      const outcomes = names.map((n) => status.profiles[n]);
      const outcome = outcomes[0];
      if (!outcome || "error" in outcome || outcomes.some((o) => JSON.stringify(o) !== JSON.stringify(outcome))) continue;
      applied.set(engine, { generation: status.generation, wanted: wantedBy(outcome), outcome });
    }
  } catch (error) {
    console.warn("[scripts] couldn't read status.json", error);
  }
}

async function reconcile() {
  if (!enabled()) return;
  await seed();
  const folder: UserScriptsFolder = await readUserScripts();
  if (!enabled() || again) return;
  if (folder.state === "empty" || folder.state === "busy" || folder.state === "pending") return;
  const generation = folder.generation ?? 0;
  const targets = scriptsTargets(useBrowser.getState());
  const outcomes = new Map<string, ScriptsOutcome>();
  const refused = folder.state === "invalid" ? folder.error : null;
  const loadPath = folder.state === "ready" ? folder.path : null;
  const unloadPath = folder.state === "absent" || folder.state === "invalid" ? folder.path : null;
  const wanted: Wanted = loadPath ? "present" : "absent";
  for (const engine of targets.keys()) {
    const done = applied.get(engine);
    const cached = refused === null && done?.generation === generation && done.wanted === wanted ? done.outcome : null;
    let outcome: ScriptsOutcome;
    if (cached) outcome = cached;
    else if (refused !== null) outcome = unloadPath ? withError(await unload(engine, unloadPath), refused) : { error: refused };
    else if (loadPath) outcome = await load(engine, loadPath);
    else if (unloadPath) outcome = await unload(engine, unloadPath);
    else outcome = { removed: true };
    if (!cached && (await readUserScripts()).token !== folder.token) {
      applied.delete(engine);
      again = true;
      return;
    }
    outcomes.set(engine, outcome);
    if (!("error" in outcome)) applied.set(engine, { generation, wanted, outcome });
    if (!enabled()) return;
  }
  if (again || !enabled()) return;
  const status: Status = { generation, profiles: {} };
  for (const [engine, names] of targets) for (const name of names) status.profiles[name] = outcomes.get(engine)!;
  const json = versionedJson(status, STATUS_VERSION, "version", 2);
  if (json === lastStatus) return;
  await writeUserScriptsStatus(json);
  lastStatus = json;
}

function schedule() {
  if (running) {
    again = true;
    return;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await reconcile();
      } catch (error) {
        console.warn("[scripts] couldn't apply the ardia scripts", error);
      }
    } while (again && enabled());
    running = null;
  })();
}

let started = false;

export function startUserScripts() {
  if (started || !userScriptsAvailable()) return;
  started = true;
  onUserScriptsChange(schedule);
  let watching = false;
  let key = "";
  const sync = (s: BrowserState) => {
    const on = s.settings.cliControl ?? false;
    const nextKey = on ? targetsKey(scriptsTargets(s)) : "";
    if (on === watching && nextKey === key) return;
    watching = on;
    key = nextKey;
    watchUserScripts(on);
    if (on) schedule();
  };
  sync(useBrowser.getState());
  useBrowser.subscribe((s, prev) => {
    if (s.settings.cliControl !== prev.settings.cliControl || s.profileOrder !== prev.profileOrder || s.profiles !== prev.profiles) sync(s);
  });
}

if (__DEV__) (globalThis as { acUserScripts?: unknown }).acUserScripts = { schedule, applied, scriptsTargets };
