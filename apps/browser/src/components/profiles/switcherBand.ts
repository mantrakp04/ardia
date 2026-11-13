import { layout } from "../ui/theme";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { profileSwitcher } from "./tokens";

const SIDE_ROOM = layout.sidebarInset;
const SIDE_ROOM_BESIDE_DOWNLOADS = SIDEBAR_FOOTER_DOWNLOADS.left + SIDEBAR_FOOTER_DOWNLOADS.size + 4;

export const switcherCellWidth = (icon: string | null) => (icon ? profileSwitcher.iconCell : profileSwitcher.dotCell);

export const switcherRoom = (width: number, besideDownloads: boolean) => width - 2 * (besideDownloads ? SIDE_ROOM_BESIDE_DOWNLOADS : SIDE_ROOM);

const capsuleEnd = (icon: string | null | undefined) => (profileSwitcher.band - switcherCellWidth(icon ?? null)) / 2;

export function switcherCapsuleEnds(marks: (string | null)[], room: number): { left: number; right: number } | null {
  const left = capsuleEnd(marks[0]);
  const right = capsuleEnd(marks.at(-1));
  const cells = marks.reduce((sum, icon) => sum + switcherCellWidth(icon), 0);
  return cells + left + right <= room ? { left, right } : null;
}
