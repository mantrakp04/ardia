import { layout } from "../ui/theme";
import type { Section } from "../../state/sidebar/geometry";

export const GLOW_ROOM = 24;
export const ROW_PITCH = layout.rowHeight + layout.rowGap;
export const DOCKED_BOTTOM = 6;
export const ROWS_PER_FRAME = 32;
export const DOCK_SHARE = 0.4;

export type SidebarGeometry = { viewport: number; regions: Record<Section, number>; newTabAtTop: boolean; room: number; pad: number; tilesFixed: boolean; laidOut?: () => void };
