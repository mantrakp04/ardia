import { forwardRef, type ReactNode } from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { TabDropArea, type TabDropTarget } from "../window/TabDropArea";
import { useDragController } from "./DragProvider";

export const SidebarDropArea = forwardRef<View, { style?: StyleProp<ViewStyle>; children?: ReactNode }>(function SidebarDropArea({ style, children }, ref) {
  const controller = useDragController();
  const windowId = useWindowId();
  const target: TabDropTarget = {
    windowId,
    enter: (count, [x, y]) => controller?.beginExternal(count, x, y),
    move: ([x, y]) => controller?.move(x, y),
    leave: () => void controller?.finishExternal(false),
    drop: ([x, y]) => {
      controller?.move(x, y);
      return controller?.finishExternal(true) ?? null;
    },
  };
  return (
    <TabDropArea ref={ref} target={target} style={style}>
      {children}
    </TabDropArea>
  );
});
