import { pageFrameOf, type PageFrame } from "../../lib/windowLayout";
import { usePageFrameInset } from "../../state/windows/layout";
import { layout } from "../ui/theme";
import { PEEK_RADIUS } from "./tokens";
import { sidebarCardGap } from "./dockMotion";

export type CardFrame = PageFrame & { dockGap: number };

const frames = new Map<number, CardFrame>();

export function cardFrameOf(inset: number): CardFrame {
  let frame = frames.get(inset);
  if (!frame) frames.set(inset, (frame = { ...pageFrameOf(inset, layout.cardRadius, PEEK_RADIUS), dockGap: sidebarCardGap(inset) }));
  return frame;
}

export const useCardFrame = (): CardFrame => cardFrameOf(usePageFrameInset());
