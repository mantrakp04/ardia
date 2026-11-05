import { View, type ViewProps } from "react-native";

export type MiddleClickEvent = { shiftKey: boolean; altKey: boolean; metaKey: boolean };

export type MouseAreaProps = ViewProps & {
  path?: string | null;
  onMiddleClick?: (e: MiddleClickEvent) => void;
};

type WebMouseProps = ViewProps & { onAuxClick?: (e: MouseEvent) => void; onMouseDown?: (e: MouseEvent) => void };

export function MouseArea({ path: _path, onMiddleClick, ...props }: MouseAreaProps) {
  const WebView = View as unknown as React.ComponentType<WebMouseProps>;
  return (
    <WebView
      {...props}
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
