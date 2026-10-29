import { createContext, useContext, useEffect, useReducer, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { markHoverProps } from "../../lib/hoverMarks";
import { currentWindow } from "../../state/browser/current";
import { PageProfileContext, useWindow } from "../../state/browser/hooks";
import {
  cardEntered,
  cardLaidOut,
  cardLeft,
  releaseAnchor,
  rowEntered,
  rowLeft,
  rowShown,
  rowsCovered,
  setGroupPointed,
  watchCovered,
  type HoverPointerEvent,
} from "../../state/sidebar/hover";
import type { Target } from "../../state/sidebar/sidebarUi";

export const FoldedAway = createContext(false);

export const cardHoverProps = {
  onMouseEnter: cardEntered,
  onMouseLeave: cardLeft,
  onLayout: (e: LayoutChangeEvent) => cardLaidOut(e.nativeEvent.layout),
};

export function useRowHover(windowId: string, target: Target | null) {
  const [hovered, setHovered] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const page = useContext(PageProfileContext);
  const away = useContext(FoldedAway);
  const latest = useRef({ windowId, target, page, away });
  latest.current = { windowId, target, page, away };
  const inside = useRef<HoverPointerEvent | null>(null);
  const onCurrentPage = () => {
    const { windowId, page } = latest.current;
    return !page || currentWindow(windowId)?.profileId === page;
  };
  const [enterRow] = useState(() => (event?: HoverPointerEvent) => {
    if (!onCurrentPage() || latest.current.away) return;
    const { windowId, target } = latest.current;
    watchCovered(windowId, refresh, true);
    const enter = () => {
      if (latest.current.away) return;
      setHovered(true);
      rowShown(windowId, target);
    };
    rowEntered(windowId, target, event, enter, () => setHovered(true));
  });
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: (event?: HoverPointerEvent) => {
        inside.current = { nativeEvent: { screenX: event?.nativeEvent?.screenX, screenY: event?.nativeEvent?.screenY } };
        enterRow(event);
      },
      onMouseLeave: (event?: HoverPointerEvent) => {
        inside.current = null;
        setHovered(false);
        const { windowId, target } = latest.current;
        watchCovered(windowId, refresh, false);
        rowLeft(windowId, target, event, onCurrentPage());
      },
    }),
  );
  const shownAway = useRef(away);
  useEffect(() => {
    if (shownAway.current === away) return;
    shownAway.current = away;
    if (!away) {
      if (inside.current) enterRow(inside.current);
      return;
    }
    const { windowId, target } = latest.current;
    setHovered(false);
    watchCovered(windowId, refresh, false);
    if (target) releaseAnchor(windowId, target.id);
  }, [away]);
  useEffect(
    () => () => {
      const { windowId, target } = latest.current;
      watchCovered(windowId, refresh, false);
      if (target) releaseAnchor(windowId, target.id);
    },
    [],
  );
  return { hovered: hovered && !rowsCovered(windowId), hoverProps };
}

export function useGroupHover(windowId: string, groupId: string) {
  const [inside, setInside] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const page = useContext(PageProfileContext);
  const away = useContext(FoldedAway);
  const onPage = useWindow(windowId, (w) => !page || w?.profileId === page);
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: () => setInside(true),
      onMouseLeave: () => setInside(false),
    }),
  );
  useEffect(() => {
    watchCovered(windowId, refresh, true);
    return () => watchCovered(windowId, refresh, false);
  }, [windowId]);
  const hovered = inside && onPage && !away && !rowsCovered(windowId);
  useEffect(() => {
    if (!hovered) return;
    setGroupPointed(groupId, true);
    return () => setGroupPointed(groupId, false);
  }, [hovered, groupId]);
  return { hovered, hoverProps };
}
