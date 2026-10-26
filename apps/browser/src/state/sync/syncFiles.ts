import { readDocument, saveDocument, writeDocument } from "../../platform/documents";
import { Clock, emptyScope, restoreJournal, SyncNative, writtenSeq, type LogFile } from "../../platform/sync";
import { parseSaved, versionedJson } from "../../lib/savedDocument";
import { DOC, DOC_MIGRATIONS, DOC_VERSION, JOURNAL, STATE, defaultTypes, emptyDoc, type SyncDoc } from "./syncDoc";

type Journal = Record<string, LogFile[]>;

async function openSealed<T>(name: string, fallback: T): Promise<T> {
  const sealed = readDocument(name);
  const json = sealed ? await SyncNative?.openLocal(sealed) : null;
  try {
    if (json) return JSON.parse(json) as T;
  } catch {}
  return fallback;
}

export function syncFiles(current: () => SyncDoc) {
  let savedJson = "";
  let journal: Journal = {};
  let journalOnDisk = false;
  let savedState = "";
  let sealing: Promise<void> | null = null;

  function read(): SyncDoc | null {
    try {
      const json = readDocument(DOC);
      const saved = parseSaved(json, DOC_VERSION, DOC_MIGRATIONS, "v") as SyncDoc | null;
      const loaded = saved ? { ...emptyDoc(), ...saved, types: { ...defaultTypes(), ...saved.types }, scopes: {} } : null;
      savedJson = json ?? "";
      return loaded;
    } catch (error) {
      console.warn("[sync] couldn't read sync.json", error);
      return null;
    }
  }

  async function loadState() {
    const scopes = await openSealed<SyncDoc["scopes"]>(STATE, {});
    journal = (await openSealed<{ journal?: Journal }>(JOURNAL, {})).journal ?? {};
    journalOnDisk = Object.keys(journal).length > 0;
    const doc = current();
    const clock = new Clock(doc.deviceId ?? "", doc.clock);
    for (const scope of new Set([...Object.keys(doc.seqs ?? {}), ...Object.keys(journal)])) {
      const mine = (journal[scope] ?? []).filter((f) => f.device === doc.deviceId);
      restoreJournal((scopes[scope] ??= emptyScope()), mine, clock, doc.seqs?.[scope]);
    }
    if (doc.deviceId && Object.keys(journal).length) doc.clock = clock.last;
    doc.scopes = scopes;
  }

  const persistJournal = (scope: string) => async (batches: LogFile[]) => {
    const list = (journal[scope] ??= []);
    for (const file of batches) if (!list.some((f) => f.seq === file.seq)) list.push(file);
    const sealed = await SyncNative!.sealLocal(JSON.stringify({ journal }));
    await saveDocument(JOURNAL, sealed);
    journalOnDisk = true;
  };

  function pruneJournal(saved: Record<string, number>) {
    for (const [scope, list] of Object.entries(journal)) {
      const left = list.filter((f) => f.seq > (saved[scope] ?? 0));
      if (left.length) journal[scope] = left;
      else delete journal[scope];
    }
    if (journalOnDisk && !Object.keys(journal).length) clearJournal();
  }

  function clearJournal() {
    journal = {};
    journalOnDisk = false;
    writeDocument(JOURNAL, "");
  }

  function save() {
    const doc = current();
    const { scopes, ...meta } = doc;
    const json = versionedJson({ ...meta, seqs: Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, writtenSeq(s)])) }, DOC_VERSION, "v");
    if (json !== savedJson) {
      savedJson = json;
      writeDocument(DOC, json);
    }
    const state = doc.enabled ? JSON.stringify(scopes) : "";
    if (state === savedState || sealing) return;
    if (!state) {
      savedState = "";
      writeDocument(STATE, "");
      return;
    }
    const seqs = Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, s.seq]));
    sealing = (async () => {
      try {
        const sealed = await SyncNative?.sealLocal(state);
        if (sealed) {
          await saveDocument(STATE, sealed);
          savedState = state;
          pruneJournal(seqs);
        }
      } catch (error) {
        console.warn("[sync] couldn't save the sync state", error);
      } finally {
        sealing = null;
      }
      const after = current();
      if (after.enabled && JSON.stringify(after.scopes) !== savedState) save();
    })();
  }

  return { read, loadState, persistJournal, clearJournal, save };
}
