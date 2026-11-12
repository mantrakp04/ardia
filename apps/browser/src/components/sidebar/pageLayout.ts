import { layout } from "../ui/theme";
import type { Section } from "../../state/sidebar/geometry";

export const GLOW_ROOM = 24;
export const ROW_PITCH = layout.rowHeight + layout.rowGap;
export const DOCKED_BOTTOM = 6;
export const ROWS_PER_FRAME = 32;
export const DOCK_SHARE = 0.4;

export type SidebarGeometry = { viewport: number; regions: Record<Section, number>; newTabAtTop: boolean; tilesFixed: boolean; laidOut?: () => void };

export type PageLayoutInput = {
  tiles: number;
  previewed: number;
  dockRoom: number;
  gridHeight: (count: number) => number;
  dragging: boolean;
  fixedBeforeDrag: boolean;
  listHeight: number;
  dockAbove: number;
};

export type PageLayout = { dockFixed: boolean; capped: boolean; docked: boolean };

export const tilesFitDock = ({ tiles, gridHeight, dockRoom }: Pick<PageLayoutInput, "tiles" | "gridHeight" | "dockRoom">) => !tiles || gridHeight(tiles) <= dockRoom;

export function pageLayout(i: PageLayoutInput): PageLayout {
  const dockFixed = i.dragging ? i.fixedBeforeDrag : tilesFitDock(i);
  return {
    dockFixed,
    capped: dockFixed && i.dragging && i.gridHeight(i.previewed) > i.dockRoom,
    docked: i.listHeight > i.dockAbove,
  };
}
