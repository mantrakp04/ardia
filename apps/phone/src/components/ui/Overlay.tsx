import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { StyleSheet, View } from "react-native";

export type WindowRect = { x: number; y: number; width: number; height: number };

type Overlay = { show: (id: number, node: ReactNode | null) => void; frame: () => Promise<WindowRect> };

const OverlayContext = createContext<Overlay | null>(null);

let nextId = 0;

const measure = (view: View | null): Promise<WindowRect> =>
  new Promise((resolve) => {
    if (!view) resolve({ x: 0, y: 0, width: 0, height: 0 });
    else view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });

export function OverlayHost({ children }: { children: ReactNode }) {
  const root = useRef<View>(null);
  const [layers, setLayers] = useState<{ id: number; node: ReactNode }[]>([]);
  const overlay = useMemo<Overlay>(
    () => ({
      show: (id, node) =>
        setLayers((now) => {
          if (node === null) return now.filter((layer) => layer.id !== id);
          return now.some((layer) => layer.id === id) ? now.map((layer) => (layer.id === id ? { id, node } : layer)) : [...now, { id, node }];
        }),
      frame: () => measure(root.current),
    }),
    [],
  );
  return (
    <OverlayContext.Provider value={overlay}>
      {children}
      <View ref={root} style={StyleSheet.absoluteFill} pointerEvents="box-none" collapsable={false}>
        {layers.map((layer) => (
          <Fragment key={layer.id}>{layer.node}</Fragment>
        ))}
      </View>
    </OverlayContext.Provider>
  );
}

export function Portal({ children }: { children: ReactNode }) {
  const overlay = useContext(OverlayContext);
  const [id] = useState(() => ++nextId);
  useLayoutEffect(() => {
    overlay?.show(id, children);
  });
  useEffect(() => () => overlay?.show(id, null), [overlay, id]);
  return overlay ? null : <>{children}</>;
}

export function useOverlayFrame() {
  const overlay = useContext(OverlayContext);
  return overlay ? overlay.frame : () => Promise.resolve({ x: 0, y: 0, width: 0, height: 0 });
}

export const measureAnchor = (anchor: RefObject<View | null>) => measure(anchor.current);
