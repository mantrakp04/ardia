import { layout } from "../ui/theme";
import { radius } from "../ui/tokens";
import { profileSwitcher } from "../profiles/tokens";

export const LIVE_FOLDER_PAD = 2;
export const groupMembersPadBottom = (shown: number, pad: number) => (shown ? pad : 0);

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
