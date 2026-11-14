const NONE = {
  live_completed_tabs_closed: 0,
  live_row_hides: 0,
  live_stack_hides: 0,
  live_account_connects: 0,
  live_account_connects_beside_another_profile: 0,
  live_legacy_account_copies: 0,
  live_legacy_account_copy_refusals: 0,
};

export type LiveFolderCount = keyof typeof NONE;

let counts = { ...NONE };

export function noteLiveFolders(count: LiveFolderCount, by = 1) {
  counts[count] += by;
}

export function takeLiveFolderCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
