import { SIDEBAR_GROUP } from "../../lib/sidebarMetrics";
import { layout } from "../ui/theme";

export const GROUP_PAD = SIDEBAR_GROUP.pad;
export const GROUP_INDENT = SIDEBAR_GROUP.indent;
export const GROUP_BORDER = SIDEBAR_GROUP.border;
export const GROUP_RADIUS = SIDEBAR_GROUP.radius;
export const GROUP_HEADER_RADIUS = GROUP_RADIUS - GROUP_BORDER;

export const SIDEBAR_FIELD = { top: 46, height: layout.rowHeight, radius: 10 } as const;
export const SIDEBAR_FOOTER_DOWNLOADS = { bottom: 3 + (41 - 3 - 34) / 2, size: 34 } as const;
export function listTopGap(addressBar: boolean): number {
  return addressBar ? 6 : layout.pinnedTop - layout.sidebarHeader;
}

export const SIDEBAR_HEADER_WITH_FIELD = SIDEBAR_FIELD.top + SIDEBAR_FIELD.height;
