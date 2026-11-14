import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import type { LayoutChangeEvent, NativeMethods, ViewProps } from "react-native";
import { followMotion } from "../animation/motion";
import { setCover } from "./covers";
import { engineAvailable } from "./host";
import { WindowIdContext } from "./windowId";

export const CoverAncestry = createContext<readonly string[]>([]);

const SETTLE_MS = [0, 120, 400];
let covers = 0;

function assign<Node>(target: Ref<Node> | undefined, node: Node | null) {
  if (typeof target === "function") target(node);
  else if (target) target.current = node;
}

export function usePageCover<Node extends Pick<NativeMethods, "measureInWindow">>(forwarded: Ref<Node> | undefined, onLayout: ViewProps["onLayout"], radius = 0) {
  const windowId = useContext(WindowIdContext);
  const above = useContext(CoverAncestry);
  const id = useRef(`cover-${++covers}`).current;
  const node = useRef<Node | null>(null);
  const live = engineAvailable();
  const ancestry = useMemo(() => [...above, id], [above, id]);

  const measure = useCallback(() => {
    if (!live) return;
    node.current?.measureInWindow((x, y, width, height) => {
      if (node.current) setCover(windowId, id, { x, y, width, height, radius });
    });
  }, [live, windowId, id, radius]);

  const ref = useCallback(
    (value: Node | null) => {
      node.current = value;
      assign(forwarded, value);
    },
    [forwarded],
  );

  useEffect(() => {
    if (!live) return;
    const timers = SETTLE_MS.map((delay) => setTimeout(measure, delay));
    const unfollow = followMotion(measure);
    return () => {
      unfollow();
      timers.forEach(clearTimeout);
      setCover(windowId, id, null);
    };
  }, [live, measure, windowId, id]);

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
