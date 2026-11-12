import type { ComponentType } from "react";
import { ActivitySpinner } from "./ActivitySpinner";
import { ThemeSwatch, WindowBackdrop } from "./backdrop";
import { DockSelection } from "./DockSelection";
import { FadeLabel } from "./FadeLabel";
import { ContextMenuArea, FileDrop, MagnifyArea, MouseArea, OutsidePressArea, WindowProfile } from "./inputAreas";
import { GlassEffect, GlassGroup, PopoverBubble, VisualEffect } from "./materials";
import { Surface } from "./Surface";
import { SwipeArea } from "../pager/SwipeArea";

export { OutsidePressRoot } from "./inputAreas";

export const viewsDrawnInJs = new Map<string, ComponentType<any>>([
  ["ArdiaSurface", Surface],
  ["ArdiaFadeLabel", FadeLabel],
  ["ArdiaActivitySpinner", ActivitySpinner],
  ["ArdiaVisualEffect", VisualEffect],
  ["ArdiaGlassEffect", GlassEffect],
  ["ArdiaGlassGroup", GlassGroup],
  ["ArdiaPopoverBubble", PopoverBubble],
  ["ArdiaWindowBackdrop", WindowBackdrop],
  ["ArdiaContextMenuArea", ContextMenuArea],
  ["ArdiaOutsidePressArea", OutsidePressArea],
  ["ArdiaFileDrag", MouseArea],
  ["ArdiaMagnifyArea", MagnifyArea],
  ["ArdiaFileDrop", FileDrop],
  ["ArdiaThemeSwatch", ThemeSwatch],
  ["ArdiaDockSelection", DockSelection],
  ["ArdiaWindowProfile", WindowProfile],
  ["ArdiaSwipe", SwipeArea],
]);
