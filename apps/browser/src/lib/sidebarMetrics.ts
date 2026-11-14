import { activeLook } from "./activeLook";

export const SIDEBAR_ROW = {
  get height() {
    return activeLook().metrics.rowHeight;
  },
  get gap() {
    return activeLook().metrics.rowGap;
  },
  get pinnedHeight() {
    return activeLook().metrics.pinnedHeight;
  },
};

export const SIDEBAR_GROUP = { indent: 16, border: 0.5, radius: 12, inset: 3 } as const;

export const GROUP_MEMBERS_PAD_BOTTOM = SIDEBAR_GROUP.inset - SIDEBAR_GROUP.border;
