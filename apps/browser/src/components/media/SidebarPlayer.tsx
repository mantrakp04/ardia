import { FadeLabel, Surface, Symbol, Button, useHover } from "../ui";
import { useShallow } from "zustand/react/shallow";
import { useRef, type ComponentProps } from "react";
import { Image, Pressable, View } from "react-native";
import { switchToTab, toggleMute } from "../../state/browser/actions";
import { hex, useTheme } from "../ui/theme";
import { font, ink, radius, space } from "../ui/tokens";
import { useTab } from "../../state/browser/hooks";
import { Favicon } from "../favicon/Favicon";
import { useSidebarTokens } from "../sidebar/tokens";
import { useArtwork } from "../../state/media/artwork";
import { seekTo, SeekBar, skip } from "./MiniPlayer";
import { dismissPlayer, hasTrackControls, isPlaying, mediaCommand, playerTabFor, SKIP_SECONDS, useHiddenPlayerTabs, useMedia, useSession, useTicker } from "../../state/media/media";
import { hostOf } from "../../lib/url";
import { useMediaTokens } from "./tokens";

export const SIDEBAR_PLAYER_HEIGHT = 74 + 8;
const CORNER_BUTTON_SIZE = 18;

export function useSidebarPlayerTab(windowId: string, profileId: string): string | undefined {
  const sessions = useMedia(useShallow((m) => Object.keys(m.sessions)));
  const hidden = useHiddenPlayerTabs(windowId, profileId, sessions);
  const shown = useRef<string | undefined>(undefined);
  shown.current = useMedia((m) => playerTabFor(m, hidden, shown.current));
  return shown.current;
}

export function SidebarPlayer({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const media = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const playing = isPlaying(session);
  const { hovered, hoverProps } = useHover();
  const artwork = useArtwork(tabId, session?.artwork);
  if (!session || !tab) return null;
  const tracks = hasTrackControls(session);
  const title = session.title || tab.title;
  const subtitle = session.artist || hostOf(tab.url);
  const go = () => switchToTab(tabId);

  return (
    <View {...hoverProps} style={{ height: SIDEBAR_PLAYER_HEIGHT - 8 }}>
      <Surface fill={hex(tokens.groupFill)} cornerRadius={radius.panel} borderColor={hex(tokens.groupStroke)} borderWidth={0.5} style={{ flex: 1, paddingHorizontal: space.sm, paddingTop: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 32 }}>
          <Pressable onPress={go} tooltip="Back to Tab">
            <View style={{ width: 32, height: 32, borderRadius: radius.m, overflow: "hidden", backgroundColor: media.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
              {artwork ? (
                <Image source={{ uri: artwork }} resizeMode="cover" style={{ width: 32, height: 32 }} />
              ) : (
                <Favicon url={tab.url} favicon={tab.favicon} size={18} profileId={tab.profileId} />
              )}
            </View>
          </Pressable>
          <Pressable onPress={go} style={{ flex: 1, marginLeft: space.m, minWidth: 0 }}>
            <FadeLabel text={title} fontSize={font.small.fontSize} weight="semibold" color={theme.textPrimary} style={{ height: 16 }} />
            <View style={{ flexDirection: "row", alignItems: "center", height: 14 }}>
              {tab.muted ? <Symbol name="speaker.slash.fill" size={9} color={theme.textSecondary} style={{ width: 13, height: 12 }} /> : null}
              <FadeLabel text={subtitle} fontSize={font.caption.fontSize} color={theme.textSecondary} style={{ flex: 1, height: 14 }} />
            </View>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", height: 24, marginTop: 4, marginLeft: -4 }}>
          <Button variant="icon"
            icon={tracks ? "backward.fill" : `gobackward.${SKIP_SECONDS}`}
            size={tracks ? 10 : 12}
            box={24}
            radius={radius.m}
            tooltip={tracks ? "Play Previous Track" : `Skip back ${SKIP_SECONDS} seconds`}
            onPress={() => (tracks ? mediaCommand(tabId, "previous") : skip(tabId, session, -SKIP_SECONDS))}
          />
          <Button variant="icon" icon={playing ? "pause.fill" : "play.fill"} size={13} box={24} radius={radius.m} tooltip={playing ? "Pause" : "Play"} onPress={() => mediaCommand(tabId, "toggle")} />
          <Button variant="icon"
            icon={tracks ? "forward.fill" : `goforward.${SKIP_SECONDS}`}
            size={tracks ? 10 : 12}
            box={24}
            radius={radius.m}
            tooltip={tracks ? "Play Next Track" : `Skip ahead ${SKIP_SECONDS} seconds`}
            onPress={() => (tracks ? mediaCommand(tabId, "next") : skip(tabId, session, SKIP_SECONDS))}
          />
          {session.duration ? (
            <View style={{ flex: 1, flexDirection: "row", marginLeft: 6 }}>
              <TickingSeekBar playing={playing} session={session} tokens={media} height={12} barHeight={3} onSeek={(p) => seekTo(tabId, session, p * session.duration!)} />
            </View>
          ) : null}
        </View>
      </Surface>
      {hovered ? (
        <View style={{ position: "absolute", top: -6, right: -6, flexDirection: "row", gap: 2 }}>
          <CornerButton icon={tab.muted ? "speaker.wave.2.fill" : "speaker.slash.fill"} tooltip={tab.muted ? "Unmute Site" : "Mute Site"} onPress={() => toggleMute(tabId)} />
          <CornerButton icon="xmark" tooltip="Close Player" onPress={() => dismissPlayer(tabId)} />
        </View>
      ) : null}
    </View>
  );
}

function TickingSeekBar({ playing, ...props }: { playing: boolean } & ComponentProps<typeof SeekBar>) {
  useTicker(playing, 1000);
  return <SeekBar {...props} />;
}

function CornerButton({ icon, tooltip, onPress }: { icon: string; tooltip: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress}>
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={CORNER_BUTTON_SIZE / 2}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor={ink.black}
          shadowOpacity={theme.panelShadowOpacity * 0.5}
          shadowRadius={3}
          shadowOffset={[0, 1]}
          style={{ width: CORNER_BUTTON_SIZE, height: CORNER_BUTTON_SIZE, alignItems: "center", justifyContent: "center" }}
        >
          <Symbol name={icon} size={8} weight="bold" color={hovered ? theme.textPrimary : theme.textSecondary} style={{ width: 12, height: 12 }} />
        </Surface>
      </Pressable>
    </View>
  );
}
