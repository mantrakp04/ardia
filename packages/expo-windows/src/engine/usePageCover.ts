import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import type { LayoutChangeEvent } from "react-native";
import { setCover } from "./covers";
import { engineAvailable } from "./host";
import { WindowIdContext } from "./windowId";

type Measured = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

export const CoverAncestry = createContext<readonly string[]>([]);

const SETTLE_MS = [0, 120, 400];
let covers = 0;

function assign<Node>(target: Ref<Node> | undefined, node: Node | null) {
  if (typeof target === "function") target(node);
  else if (target) (target as { current: Node | null }).current = node;
}

export function usePageCover<Node>(forwarded: Ref<Node> | undefined, onLayout: unknown) {
  const windowId = useContext(WindowIdContext);
  const above = useContext(CoverAncestry);
  const id = useRef(`cover-${++covers}`).current;
  const node = useRef<Measured | null>(null);
  const live = engineAvailable();
  const ancestry = useMemo(() => [...above, id], [above, id]);

  const measure = useCallback(() => {
    if (!live) return;
    node.current?.measureInWindow((x, y, width, height) => {
      if (node.current) setCover(windowId, id, { x, y, width, height });
    });
  }, [live, windowId, id]);

  const ref = useCallback(
    (value: Node | null) => {
      node.current = value as unknown as Measured | null;
      assign(forwarded, value);
    },
    [forwarded],
  );

  useEffect(() => {
    if (!live) return;
    const timers = SETTLE_MS.map((delay) => setTimeout(measure, delay));
    return () => {
      timers.forEach(clearTimeout);
      setCover(windowId, id, null);
    };
  }, [live, measure, windowId, id]);

  const layout = useCallback(
    (event: LayoutChangeEvent) => {
      measure();
      if (typeof onLayout === "function") (onLayout as (event: LayoutChangeEvent) => void)(event);
    },
    [measure, onLayout],
  );

  const within = useCallback((children: ReactNode) => (live ? createElement(CoverAncestry.Provider, { value: ancestry }, children) : children), [live, ancestry]);

  return { ref, onLayout: layout, within };
}
