import { useEffect, useRef } from "react";
import { View, type ViewProps } from "react-native";
import { ardiaHost, hostSupports, invokeHost, reportHostError } from "../../host";
import { createFileDragGesture } from "../../fileDrag";
import { FILE_DRAG } from "../../fileCapabilities";

export type MiddleClickEvent = { shiftKey: boolean; altKey: boolean; metaKey: boolean };

export type MouseAreaProps = ViewProps & {
  path?: string | null;
  onMiddleClick?: (e: MiddleClickEvent) => void;
};

type WebMouseProps = ViewProps & { onAuxClick?: (e: MouseEvent) => void; onMouseDown?: (e: MouseEvent) => void };

const beginFileDrag = (path: string) =>
  void invokeHost(FILE_DRAG, { args: [path] }).catch((error: { code?: string }) => error?.code !== "ERR_DRAG_RELEASED" && reportHostError(error));

export function MouseArea({ path, onMiddleClick, ...props }: MouseAreaProps) {
  const WebView = View as unknown as React.ComponentType<WebMouseProps & { ref?: (value: unknown) => void }>;
  const node = useRef<HTMLElement | null>(null);
  const latestPath = useRef(path);
  latestPath.current = path;
  const draggable = !!path && !!ardiaHost && hostSupports(FILE_DRAG);

  useEffect(() => {
    const element = node.current;
    if (!element || !draggable) return;
    const gesture = createFileDragGesture(beginFileDrag);
    const down = (e: PointerEvent) => gesture.down({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, button: e.button }, latestPath.current);
    const move = (e: PointerEvent) => {
      if (gesture.move({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, buttons: e.buttons })) e.preventDefault();
    };
    const up = () => gesture.up();
    const click = (e: MouseEvent) => {
      if (!gesture.consumeClick()) return;
      e.preventDefault();
      e.stopPropagation();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("click", click, true);
    };
  }, [draggable]);

  return (
    <WebView
      {...props}
      ref={(value) => {
        node.current = value as HTMLElement | null;
      }}
      onMouseDown={(e) => {
        if (e.button === 1 && onMiddleClick) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1 || !onMiddleClick) return;
        e.preventDefault();
        e.stopPropagation();
        onMiddleClick({ shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey });
      }}
    />
  );
}
