import { pageFrameOf, type PageFrame } from "../../lib/windowLayout";
import { usePageFrameInset, windowCornerRadius } from "../../state/windows/layout";
import { perLook } from "../ui/tokens";
import { peekRadius } from "./tokens";
import { sidebarCardGap } from "./dockMotion";

export type CardFrame = PageFrame & { dockGap: number };

const framesOfLook = perLook(() => new Map<number, CardFrame>());

export function cardFrameOf(inset: number): CardFrame {
  const frames = framesOfLook();
  let frame = frames.get(inset);
  if (!frame) frames.set(inset, (frame = { ...pageFrameOf(inset, windowCornerRadius(), peekRadius()), dockGap: sidebarCardGap(inset) }));
  return frame;
}

export const useCardFrame = (): CardFrame => cardFrameOf(usePageFrameInset());
