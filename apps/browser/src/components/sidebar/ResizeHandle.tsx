import { View } from "react-native";
import { currentSettings } from "../../state/browser/current";
import { useSidebarSide } from "../../state/browser/hooks";
import { updateSettings } from "../../state/settings/actions";
import { resetSidebarWidth } from "../../state/sidebar/actions";
import { useResizeDrag } from "./useResizeDrag";
import { setLiveSidebarWidth } from "../../state/sidebar/sidebarUi";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./tokens";

export function ResizeHandle({ windowId }: { windowId: string }) {
  const right = useSidebarSide(windowId) === "right";
  const handlers = useResizeDrag({
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    direction: right ? -1 : 1,
    saved: () => currentSettings().sidebarWidth,
    onLive: (w) => setLiveSidebarWidth(windowId, w),
    onCommit: (w) => updateSettings({ sidebarWidth: w }),
  });
  return (
    <View
      {...handlers}
      onDoubleClick={resetSidebarWidth}
      style={{ position: "absolute", top: 46, bottom: 0, [right ? "left" : "right"]: 0, width: 4, cursor: "col-resize" }}
    />
  );
}
