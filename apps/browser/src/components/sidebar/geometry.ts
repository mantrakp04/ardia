import { GROUP_MEMBERS_PAD_BOTTOM, SIDEBAR_GROUP } from "../../lib/sidebarMetrics";
import { layout } from "../ui/theme";
import { radius } from "../ui/tokens";
import { profileSwitcher } from "../profiles/tokens";

export const LIVE_FOLDER_PAD = 2;
export const GROUP_INDENT = SIDEBAR_GROUP.indent;
export const GROUP_BORDER = SIDEBAR_GROUP.border;
export const GROUP_RADIUS = SIDEBAR_GROUP.radius;
export const GROUP_INNER_RADIUS = GROUP_RADIUS - GROUP_BORDER;
export const GROUP_INSET = SIDEBAR_GROUP.inset;
export const groupMembersPadBottom = (shown: number) => (shown ? GROUP_MEMBERS_PAD_BOTTOM : 0);

export const SIDEBAR_FIELD = { top: 46, height: layout.rowHeight, radius: radius.chrome } as const;
const DOWNLOADS_BUTTON_SIZE = 34;
const FOOTER_BAND_BOTTOM = 3;
const FOOTER_DOWNLOADS_BOTTOM = FOOTER_BAND_BOTTOM + (profileSwitcher.height - FOOTER_BAND_BOTTOM - DOWNLOADS_BUTTON_SIZE) / 2;
export const SIDEBAR_FOOTER_DOWNLOADS = {
  bottom: FOOTER_DOWNLOADS_BOTTOM,
  left: FOOTER_DOWNLOADS_BOTTOM,
  size: DOWNLOADS_BUTTON_SIZE,
} as const;
export function listTopGap(addressBar: boolean): number {
  return addressBar ? 6 : layout.pinnedTop - layout.sidebarHeader;
}

export const SIDEBAR_HEADER_WITH_FIELD = SIDEBAR_FIELD.top + SIDEBAR_FIELD.height;
