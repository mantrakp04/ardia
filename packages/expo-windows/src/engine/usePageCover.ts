import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import type { LayoutChangeEvent, ViewProps } from "react-native";
import { followMotion } from "../animation/motion";
import { assignRef, CoverClips, coverMeasurer, watchClips, type Measurable } from "./coverClip";
import { setCover } from "./covers";
import { engineAvailable } from "./host";
import { WindowIdContext } from "./windowId";

export const CoverAncestry = createContext<readonly string[]>([]);

const SETTLE_MS = [0, 120, 400];
let covers = 0;

export function usePageCover<Node extends Measurable>(forwarded: Ref<Node> | undefined, onLayout: ViewProps["onLayout"], radius = 0) {
  const windowId = useContext(WindowIdContext);
  const above = useContext(CoverAncestry);
  const clips = useContext(CoverClips);
  const id = useRef(`cover-${++covers}`).current;
  const node = useRef<Node | null>(null);
  const live = engineAvailable();
  const ancestry = useMemo(() => [...above, id], [above, id]);
  const measurer = useMemo(() => coverMeasurer(windowId, id, radius, () => node.current, clips), [windowId, id, radius, clips]);

  const measure = useCallback(() => {
    if (live) void measurer.measure();
  }, [live, measurer]);

  const ref = useCallback(
    (value: Node | null) => {
      node.current = value;
      assignRef(forwarded, value);
    },
    [forwarded],
  );

  useEffect(() => {
    if (!live) return;
    const timers = SETTLE_MS.map((delay) => setTimeout(measure, delay));
    const unfollow = followMotion(measure);
    const unwatch = watchClips(clips, measure);
    return () => {
      unfollow();
      unwatch();
      timers.forEach(clearTimeout);
      measurer.stop();
      setCover(windowId, id, null);
    };
  }, [live, measure, measurer, clips, windowId, id]);

  const layout = useCallback(
    (event: LayoutChangeEvent) => {
      measure();
      onLayout?.(event);
    },
    [measure, onLayout],
  );

  const within = useCallback((children: ReactNode) => (live ? createElement(CoverAncestry.Provider, { value: ancestry }, children) : children), [live, ancestry]);

  return { ref, onLayout: layout, within };
}
