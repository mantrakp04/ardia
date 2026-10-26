import { useEffect, useRef } from "react";
import { layout } from "../../lib/theme";
import { dockMoving, useDockMotion } from "../layout/dockMotion";
import { setUrlAnchor, useCardAnchors, useUrlAnchors } from "../layout/windowLayout";

function dockedOnLeft(windowId: string) {
  const current = useUrlAnchors.getState()[windowId];
  if (current?.sidebar) setUrlAnchor(windowId, { ...current, left: layout.sidebarInset });
}

export function useSideSwitchAnchor(windowId: string, right: boolean, anchor: () => void) {
  const cardWidth = useCardAnchors((a) => (right ? a[windowId]?.width : undefined));
  const measuredFor = useRef({ right, cardWidth });
  const watching = right || measuredFor.current.right;
  const moving = useDockMotion((m) => watching && !!m.moving[windowId]);
  useEffect(() => {
    if (moving || dockMoving(windowId)) return;
    const was = measuredFor.current;
    if (!right) {
      measuredFor.current = { right, cardWidth };
      if (was.right) dockedOnLeft(windowId);
      return;
    }
    if (was.right && cardWidth === was.cardWidth) return;
    measuredFor.current = { right, cardWidth };
    anchor();
  }, [right, cardWidth, moving]);
}
