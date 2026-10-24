import { layout } from "../../lib/theme";
import { ARC_LIGHTS_CENTER, HEADER_TOOLS, PEEK_ORIGIN } from "./dockMotion";

const LIGHT_RADIUS = 7;
const LIGHTS_MARGIN = [ARC_LIGHTS_CENTER[0] - LIGHT_RADIUS - PEEK_ORIGIN[0], ARC_LIGHTS_CENTER[1] - LIGHT_RADIUS - PEEK_ORIGIN[1]] as const;

export const LIGHTS_CORNER = {
  width: HEADER_TOOLS.lightsRight + LIGHTS_MARGIN[0],
  height: ARC_LIGHTS_CENTER[1] + LIGHT_RADIUS + LIGHTS_MARGIN[1],
} as const;
export const LIGHTS_NOTCH = {
  width: LIGHTS_CORNER.width - layout.cardInset,
  height: LIGHTS_CORNER.height - layout.cardTop,
  radius: layout.cardRadius,
} as const;
export const LIGHTS_HIDDEN_OFFSET = LIGHTS_CORNER.width + LIGHT_RADIUS;
export const LIGHTS_BUBBLE = { width: 34, height: 2 * layout.cardRadius, zone: 52, slack: 6 } as const;
