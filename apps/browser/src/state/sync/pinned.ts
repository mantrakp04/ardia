import type { Adapter } from "../../platform/sync";
import { inTodaysNames } from "./adapters";
import { groupLooksAdapter } from "./groupLooksAdapter";
import { applyPinned } from "./pinnedApply";
import { extractPinned } from "./pinnedExtract";
import { pinnedHomesAdapter } from "./pinnedHomesAdapter";
import { pinnedOrderAdapter } from "./pinnedOrderAdapter";
import { pinnedRowsAdapter } from "./pinnedRowsAdapter";
import { tileFoldersAdapter } from "./tileFoldersAdapter";

export function pinnedAreaAdapters(spaceId: string, workspaceOnly = false): Adapter[] {
  return [
    ...(!workspaceOnly ? [tileFoldersAdapter(spaceId)] : []),
    pinnedRowsAdapter(spaceId, workspaceOnly),
    pinnedOrderAdapter(spaceId),
    groupLooksAdapter(spaceId),
    inTodaysNames(pinnedHomesAdapter(spaceId)),
    inTodaysNames(pinnedAdapter(spaceId, workspaceOnly)),
  ];
}

export function pinnedAdapter(spaceId: string, workspaceOnly = false): Adapter {
  return {
    prefix: "pin",
    extract: (base, queued, now, _known, _remote, stamp) => extractPinned(spaceId, base, queued, now, stamp, workspaceOnly),
    apply: (visible, changed, base, records) => applyPinned(spaceId, visible, changed, base, records, workspaceOnly),
  };
}
