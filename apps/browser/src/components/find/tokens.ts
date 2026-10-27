import { curve } from "../ui/motion";
import { POPOVER_MARGIN } from "../ui/Popover";
import { colorRoles, ink, radius, type ShadowLevel } from "../ui/tokens";

export const FIND_SHADOW = {
  color: ink.black,
  opacity: { dark: colorRoles.dark.panelShadowOpacity, light: colorRoles.light.panelShadowOpacity },
  radius: 16,
  offset: [0, 6],
} satisfies ShadowLevel;

export const FIND_APPEAR = { duration: 160, easing: curve.outCubic } as const;

const FIND_INSET = 7;

export const FIND_BAR = {
  margin: POPOVER_MARGIN,
  left: 14,
  right: FIND_INSET,
  buttonRadius: radius.panel - FIND_INSET,
} as const;
