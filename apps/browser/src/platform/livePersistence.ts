import { readDocument, writeDocument } from "./documents";
import { parseSaved, unchanged, versionedJson } from "../lib/savedDocument";

export type LiveProjection = Record<string, unknown>;
export type LiveCompletionInvalidation = { folderId: string; fence: unknown };
export type LivePersistenceIntent = { kind: "placement"; placed: { id: string; after: string | null }[] } | { kind: "refresh" | "completion"; folderId: string; fence?: unknown; completionIds?: string[] };
export type LivePersistenceBinding = {
  load(): LiveProjection;
  start(apply: (payload: LiveProjection, invalidated?: LiveCompletionInvalidation[]) => void): void;
  changed(before: LiveProjection, after: LiveProjection, intent?: LivePersistenceIntent): void;
  newFolderId(): string;
  completionFence(folderId: string, ids: string[], fence: unknown): unknown | null;
  beginRefresh(folderId: string): Promise<unknown> | undefined;
};

export function createLivePersistence(): LivePersistenceBinding {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let counter = 0;
  return {
    load: () => {
      try { return parseSaved(readDocument("live.json"), 1, { 0: unchanged }) ?? {}; }
      catch { return {}; }
    },
    start: () => {},
    changed: (_before, after) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { writeDocument("live.json", versionedJson(after, 1)); }
        catch (error) { console.warn("Couldn't save live folders", error); }
      }, 800);
    },
    newFolderId: () => `lf-${Date.now().toString(36)}-${(++counter).toString(36)}`,
    completionFence: (_folderId, _ids, fence) => fence,
    beginRefresh: () => undefined,
  };
}
