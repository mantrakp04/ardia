import { curve } from "../ui/motion";
import { colorRoles, ink, type ShadowLevel } from "../ui/tokens";

export const FIND_SHADOW = {
  color: ink.black,
  opacity: { dark: colorRoles.dark.panelShadowOpacity, light: colorRoles.light.panelShadowOpacity },
  radius: 16,
  offset: [0, 6],
} satisfies ShadowLevel;

export const FIND_APPEAR = { duration: 160, easing: curve.outCubic } as const;
