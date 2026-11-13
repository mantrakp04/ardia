import type { ScopeState } from "../../platform/sync";
import { PROFILE, PROFILE_THEME, PROFILE_TOP_APPS, SHARE } from "./records";
import { themeAngleKey } from "./profileAdapters";
import { linkedProfileId, remoteProfileRecord } from "./profileLinks";
import type { SyncDoc } from "./syncDoc";

let removals = 0;

const recordKeys = (syncId: string) => [...[PROFILE, SHARE, PROFILE_THEME, PROFILE_TOP_APPS].map((prefix) => `${prefix}${syncId}`), themeAngleKey(syncId)];

export const removedRecordKeys = (doc: SyncDoc): ReadonlySet<string> => new Set((doc.removing ?? []).flatMap(recordKeys));

export const beingRemoved = (doc: SyncDoc, syncId: string) => !!doc.removing?.includes(syncId);

export function markRemoved(doc: SyncDoc, syncId: string): boolean {
  if (!remoteProfileRecord(doc, syncId) || linkedProfileId(doc, syncId) || beingRemoved(doc, syncId)) return false;
  doc.removing = [...(doc.removing ?? []), syncId];
  removals++;
  return true;
}

export function settleRemovals(doc: SyncDoc, app: ScopeState) {
  if (!app.joined) return;
  const left = (doc.removing ?? []).filter((syncId) => recordKeys(syncId).some((key) => key in app.base));
  if (left.length) doc.removing = left;
  else delete doc.removing;
}

export function takeSyncedProfileRemovals() {
  const taken = removals;
  removals = 0;
  return taken;
}
