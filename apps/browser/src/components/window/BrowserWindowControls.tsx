import { useMemo } from "react";
import { useActiveTabId, useWindowId } from "../../state/browser/hooks";
import { usePageFrameInset, useWindowControlsCenterY, useWindowControlsHost, useWindowControlsSize } from "../../state/windows/layout";
import { STRIP_HEIGHT } from "../../state/windows/toolbarAutoHide";
import { WINDOW_CONTROLS } from "../../lib/windowChrome";
import { TintInk } from "../ui/TintInk";
import { useSitePalette } from "../toolbar/useSitePalette";
import { usePaneChrome } from "../toolbar/WindowToolbar";
import { controlsShown, WindowControls } from "./WindowControls";

export function BrowserWindowControls() {
  return controlsShown ? <PlacedControls /> : null;
}

function PlacedControls() {
  const windowId = useWindowId();
  const centerY = useWindowControlsCenterY();
  const size = useWindowControlsSize();
  const host = useWindowControlsHost();
  if (centerY === null || !host) return null;
  if (host === "toolbar") return <ToolbarControls windowId={windowId} centerY={centerY} size={size} />;
  return (
    <TintInk>
      <WindowControls windowId={windowId} centerY={centerY} size={size} />
    </TintInk>
  );
}

function ToolbarControls({ windowId, centerY, size }: { windowId: string; centerY: number; size: number }) {
  const activeId = useActiveTabId() ?? "";
  const palette = useSitePalette(activeId);
  const frame = usePageFrameInset();
  const pane = usePaneChrome(windowId);
  const live = pane && pane.tabId === activeId ? pane : undefined;
  const ink = useMemo(() => ({ icon: palette.icon, hover: palette.hover, pressed: palette.pressed }), [palette.icon, palette.hover, palette.pressed]);
  const fades = useMemo(
    () =>
      live && {
        row: live.fade.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 1], outputRange: [1, 0.45, 0.15, 0, 0] }),
        strip: live.fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
      },
    [live?.fade],
  );
  const collapsed = live?.mode === "collapsed";
  return (
    <>
      <WindowControls windowId={windowId} centerY={centerY} size={size} ink={ink} opacity={fades ? fades.row : 1} hidden={collapsed} />
      {fades ? (
        <WindowControls windowId={windowId} centerY={frame + STRIP_HEIGHT / 2} size={WINDOW_CONTROLS.strip} ink={ink} opacity={fades.strip} hidden={!collapsed} />
      ) : null}
    </>
  );
}
