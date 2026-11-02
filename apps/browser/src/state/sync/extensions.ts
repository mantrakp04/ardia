import { useBrowser } from "../browser/store";
import { applyExtensionsSync, extensionsSyncState, onExtensionsSync, type ExtensionsSyncApply } from "../../platform/extensions";
import { readDocument, writeDocument } from "../../platform/documents";
import { extensionsAdapter, type ExtensionChange, type ExtensionIntent, type ExtensionsAdapter, type LocalExtensions } from "../../platform/sync";
import { engineProfile } from "../browser/model";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

const DOC = "sync-extensions.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };

type Intents = { generation: number; profiles: Record<string, Record<string, ExtensionIntent>> };

let intents: Intents | null = null;

function stored(): Intents {
  if (intents) return intents;
  try {
    const saved = (parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS) ?? {}) as Partial<Intents>;
    intents = { generation: Number(saved.generation) || 0, profiles: saved.profiles ?? {} };
  } catch {
    intents = { generation: 0, profiles: {} };
  }
  return intents;
}

const save = () => writeDocument(DOC, versionedJson(stored(), DOC_VERSION));

function note(profile: string, id: string, kind: ExtensionIntent["kind"]) {
  const all = stored();
  (all.profiles[profile] ??= {})[id] = { kind, g: ++all.generation };
  save();
}

async function stateOf(profile: string): Promise<LocalExtensions> {
  const { intents, ...state } = await extensionsSyncState(profile);
  for (const i of intents) note(profile, i.id, i.kind);
  return state;
}

async function readLocal(profile: string): Promise<LocalExtensions | null> {
  try {
    return await stateOf(profile);
  } catch {
    return null;
  }
}

const changeListeners = new Set<(profile: string) => void>();

export const onSyncedExtensionChange = (listener: (profile: string) => void) => void changeListeners.add(listener);

async function change(profile: string, c: ExtensionChange): Promise<boolean> {
  const apply: ExtensionsSyncApply =
    c.kind === "cancel" ? { id: c.id, record: { removed: true } } : { id: c.id, record: c.record, ...(c.approval ? { approval: c.approval } : {}) };
  try {
    await applyExtensionsSync(profile, apply);
    return true;
  } catch (error) {
    console.warn(`[sync] extension ${c.kind} ${c.id} failed`, error);
    return false;
  } finally {
    for (const listener of changeListeners) listener(profile);
  }
}

export function extensionsAdapterFor(profileId: string): ExtensionsAdapter {
  const profile = () => engineProfile(useBrowser.getState(), profileId);
  return extensionsAdapter({
    read: () => readLocal(profile()),
    change: (c) => change(profile(), c),
    intents: () => ({ ...stored().profiles[profile()] }),
    settleIntents: (published) => {
      const byId = stored().profiles[profile()];
      if (!byId) return;
      let changed = false;
      for (const [id, g] of Object.entries(published)) {
        if (byId[id]?.g !== g) continue;
        delete byId[id];
        changed = true;
      }
      if (changed) save();
    },
    keepInstalled: (id) => note(profile(), id, "installed"),
  });
}

let watching = false;

export function watchExtensionIntents(profiles: string[]) {
  if (!watching) {
    watching = true;
    onExtensionsSync(({ profile }) => void readLocal(profile));
  }
  for (const profile of profiles) void readLocal(profile);
}
