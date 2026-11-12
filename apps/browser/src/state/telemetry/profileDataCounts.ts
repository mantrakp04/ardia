let removed = 0;
let left = 0;

export const noteProfileDataDeleted = (folderGone: boolean) => void (folderGone ? removed++ : left++);

export function takeProfileDataCounts() {
  const taken = { profile_data_removed: removed, profile_data_left: left };
  removed = 0;
  left = 0;
  return taken;
}
