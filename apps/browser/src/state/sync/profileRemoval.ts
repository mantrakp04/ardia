import { visible, type ScopeState } from "../../platform/sync";
import { isStringList } from "../../lib/decode";
import { PROFILE, PROFILE_THEME, PROFILE_TOP_APPS, SHARE, recordId, shareRecord } from "./records";
import { themeAngleKey } from "./profileAdapters";
import { linkedProfileId, remoteProfileRecord } from "./profileLinks";
import { APP_SCOPE, type SyncDoc } from "./syncDoc";

let removals = 0;

const recordKeys = (syncId: string) => [...[PROFILE, SHARE, PROFILE_THEME, PROFILE_TOP_APPS].map((prefix) => `${prefix}${syncId}`), themeAngleKey(syncId)];

const removingIds = (doc: SyncDoc) => (isStringList(doc.removing) ? doc.removing.filter((syncId) => !linkedProfileId(doc, syncId)) : []);

export const removedRecordKeys = (doc: SyncDoc): ReadonlySet<string> => new Set(removingIds(doc).flatMap(recordKeys));

export const beingRemoved = (doc: SyncDoc, syncId: string) => removingIds(doc).includes(syncId);

export function sharesItsData(doc: SyncDoc, syncId: string): boolean {
  const app = doc.scopes[APP_SCOPE];
  if (!app) return false;
  return [...visible(app, SHARE)].some(([key, value]) => {
    const sharer = recordId(SHARE, key);
    return sharer !== syncId && shareRecord(value)?.o === syncId && !!remoteProfileRecord(doc, sharer) && !beingRemoved(doc, sharer);
  });
}

export function markRemoved(doc: SyncDoc, syncId: string): boolean {
  if (!remoteProfileRecord(doc, syncId) || linkedProfileId(doc, syncId) || beingRemoved(doc, syncId) || sharesItsData(doc, syncId)) return false;
  doc.removing = [...removingIds(doc), syncId];
  removals++;
  return true;
}

export function settleRemovals(doc: SyncDoc, app: ScopeState) {
  if (!app.joined) return;
  const unapplied = new Set(app.unapplied);
  const left = removingIds(doc).filter((syncId) => recordKeys(syncId).some((key) => key in app.base || unapplied.has(key)));
  if (left.length) doc.removing = left;
  else delete doc.removing;
}

export function takeSyncedProfileRemovals() {
  const taken = removals;
  removals = 0;
  return taken;
}
