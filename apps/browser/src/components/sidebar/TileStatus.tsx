import { memo } from "react";
import { View } from "react-native";
import { Symbol } from "../ui";
import { useTheme } from "../ui/theme";
import { useSettings, useTabLive } from "../../state/browser/hooks";
import { useMedia } from "../../state/media/media";
import { useMuteState } from "../../state/tabs/hooks";
import { TileUnread } from "../unread/UnreadBadge";
import { TILE_STATUS } from "./tokens";

export const TileStatus = memo(function TileStatus({ tabId }: { tabId: string }) {
  return useSettings((s) => s.showTopAppBadges) ? <TileMarks tabId={tabId} /> : null;
});

function TileMarks({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const pip = useMedia((m) => !!m.pipOpen[tabId]);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const mute = useMuteState(tabId);
  const { pip: pipSize, speaker, box, inset } = TILE_STATUS;
  return (
    <>
      {pip ? (
        <View pointerEvents="none" style={{ position: "absolute", bottom: inset.y, left: inset.x }}>
          <Symbol name="pip" size={pipSize} color={theme.textSecondary} style={box} />
        </View>
      ) : null}
      {playing || mute ? (
        <View pointerEvents="none" style={{ position: "absolute", bottom: inset.y, right: inset.x }}>
          <Symbol name={mute ? "speaker.slash" : "speaker.wave.2"} size={speaker} color={theme.textSecondary} style={box} />
        </View>
      ) : null}
      <TileUnread tabId={tabId} />
    </>
  );
}
