import type { StyleProp, ViewStyle } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { openReadyUpdateMenu, restartToUpdate, useReadyUpdate } from "../../state/app/readyUpdate";
import { DOWNLOADS_BUTTON } from "../downloads/tokens";
import { Button, ContextMenuArea, Dot, useTheme } from "../ui";
import { UPDATE_BUTTON } from "./tokens";

const UPDATE_HIT = { width: UPDATE_BUTTON.box, height: UPDATE_BUTTON.box, plateX: 0, plateY: 0, box: UPDATE_BUTTON.box, radius: DOWNLOADS_BUTTON.radius };
const DOT_PLACE = { position: "absolute", top: UPDATE_BUTTON.dotTop, right: UPDATE_BUTTON.dotRight } as const;

export { useReadyUpdate } from "../../state/app/readyUpdate";

export function UpdateButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const ready = useReadyUpdate();
  const windowId = useWindowId();
  const theme = useTheme();
  if (!ready) return null;
  return (
    <ContextMenuArea style={style} onContextMenu={() => void openReadyUpdateMenu(windowId)}>
      <Button
        variant="icon"
        icon="arrow.clockwise.circle"
        glyph={DOWNLOADS_BUTTON.icon}
        color={theme.textPrimary}
        hit={UPDATE_HIT}
        tooltip={`Restart to Update to ${ready.displayVersion}`}
        badge={<Dot size={UPDATE_BUTTON.dot} color={theme.textPrimary} style={DOT_PLACE} />}
        onPress={restartToUpdate}
      />
    </ContextMenuArea>
  );
}
