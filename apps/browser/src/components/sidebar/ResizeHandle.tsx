import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { interfaceMetrics } from "../../lib/interfaceMetrics";
import { useSettings } from "../../state/browser/hooks";
import { View } from "react-native";
import { currentSettings } from "../../state/browser/current";
import { useSidebarSide } from "../../state/browser/hooks";
import { updateSettings } from "../../state/settings/actions";
import { resetSidebarWidth } from "../../state/sidebar/actions";
import { useResizeDrag } from "./useResizeDrag";
import { setLiveSidebarWidth } from "../../state/sidebar/sidebarUi";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./tokens";

export function ResizeHandle({ windowId }: { windowId: string }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } = useMemo(() => ({ SIDEBAR_MIN_WIDTH: scaleMetrics(BASE_INTERFACE_METRICS.SIDEBAR_MIN_WIDTH, interfaceScale), SIDEBAR_MAX_WIDTH: scaleMetrics(BASE_INTERFACE_METRICS.SIDEBAR_MAX_WIDTH, interfaceScale) }), [interfaceScale]);
  const factor = interfaceMetrics(useSettings((s) => s.interfaceSize)).factor;
  const right = useSidebarSide(windowId) === "right";
  const handlers = useResizeDrag({
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    direction: right ? -1 : 1,
    saved: () => currentSettings().sidebarWidth * factor,
    onLive: (w) => setLiveSidebarWidth(windowId, w),
    onCommit: (w) => updateSettings({ sidebarWidth: w / factor }),
  });
  return (
    <View
      {...handlers}
      onDoubleClick={resetSidebarWidth}
      style={{ position: "absolute", top: 46 * interfaceScale, bottom: 0, [right ? "left" : "right"]: 0, width: 4 * interfaceScale, cursor: "col-resize" }}
    />
  );
}

const BASE_INTERFACE_METRICS = { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH };
