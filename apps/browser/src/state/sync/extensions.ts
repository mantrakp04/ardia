import { applyExtensionsSync, extensionsSyncState, onExtensionsSync } from "../../platform/extensions";
import { readDocument, writeDocument } from "../../platform/documents";
import { extensionsAdapter, type ExtensionChange, type ExtensionIntent, type ExtensionsAdapter, type LocalExtensions } from "../../platform/sync";
import { engineProfile } from "../browser/model";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

const DOC = "sync-extensions.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };

type Intents = { generation: number; profiles: Record<string, Record<string, ExtensionIntent>> };
type EngineState = LocalExtensions & { intents?: { id: string; kind: ExtensionIntent["kind"] }[] };

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
  const state = await extensionsSyncState<EngineState>(profile);
  for (const i of state.intents ?? []) note(profile, i.id, i.kind);
  return { ready: !!state.ready, extensions: state.extensions ?? [], pending: state.pending ?? [], settling: state.settling ?? [], queued: state.queued ?? [] };
}

async function readLocal(profile: string): Promise<LocalExtensions | null> {
  try {
    return await stateOf(profile);
  } catch {
    return null;
  }
}

let available: boolean | null = null;

export const extensionSyncAvailable = () => available === true;

export async function probeExtensionSync(profile: string): Promise<boolean> {
  if (available !== null) return available;
  try {
    await stateOf(profile);
    available = true;
  } catch {}
  return available === true;
}

function refreshList(profile: string) {
  try {
    (require("../extensions/actions") as typeof import("../extensions/actions")).refreshExtensionsAfterChange(profile);
  } catch {}
}

async function change(profile: string, c: ExtensionChange): Promise<boolean> {
  const args = c.kind === "cancel" ? { id: c.id, record: { removed: true } } : { id: c.id, record: c.record, ...(c.approval ? { approval: c.approval } : {}) };
  try {
    await applyExtensionsSync(profile, args);
    return true;
  } catch (error) {
    console.warn(`[sync] extension ${c.kind} ${c.id} failed`, error);
    return false;
  } finally {
    refreshList(profile);
  }
}

export function extensionsAdapterFor(profileId: string): ExtensionsAdapter {
  const profile = () => engineProfile(profileId);
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
