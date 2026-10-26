import type { Adapter } from "../../platform/sync";
import { inTodaysNames } from "./adapters";
import { groupLooksAdapter } from "./groupLooksAdapter";
import { applyPinned } from "./pinnedApply";
import { extractPinned } from "./pinnedExtract";
import { pinnedHomesAdapter } from "./pinnedHomesAdapter";
import { pinnedOrderAdapter } from "./pinnedOrderAdapter";
import { pinnedRowsAdapter } from "./pinnedRowsAdapter";
import { tileFoldersAdapter } from "./tileFoldersAdapter";

export function pinnedAreaAdapters(profileId: string): Adapter[] {
  return [
    tileFoldersAdapter(profileId),
    pinnedRowsAdapter(profileId),
    pinnedOrderAdapter(profileId),
    groupLooksAdapter(profileId),
    inTodaysNames(pinnedHomesAdapter(profileId)),
    inTodaysNames(pinnedAdapter(profileId)),
  ];
}

export function pinnedAdapter(profileId: string): Adapter {
  return {
    prefix: "pin",
    extract: (base, queued, now) => extractPinned(profileId, base, queued, now),
    apply: (visible, changed, base, records) => applyPinned(profileId, visible, changed, base, records),
  };
}
