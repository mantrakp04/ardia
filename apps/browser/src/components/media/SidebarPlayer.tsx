import { Surface, Symbol, Button, useHover } from "../ui";
import { useShallow } from "zustand/react/shallow";
import { useRef } from "react";
import { Image, Pressable, View } from "react-native";
import { switchToTab, toggleMute } from "../../state/browser/actions";
import { hex, useTheme } from "../ui/theme";
import { font, radius, weight } from "../ui/tokens";
import { useTab } from "../../state/browser/hooks";
import { Favicon } from "../favicon/Favicon";
import { useSidebarTokens } from "../sidebar/tokens";
import { useArtwork } from "../../state/media/artwork";
import { dismissPlayer, isPlaying, mediaCommand, playerTabFor, useHiddenPlayerTabs, useMedia, useSession, type Session } from "../../state/media/media";
import { Marquee, useMarqueeGroup } from "./Marquee";
import { useMediaTokens } from "./tokens";

const ROW_HEIGHT = 40;
const ROW_INSET = 6;
const TRAILING_INSET = 4;
const ART = 28;
const LIVE_DOT = 6;
const BUTTON = 24;
const BUTTON_GAP = 2;
const TITLE_HEIGHT = 16;
const HOVER_BUTTONS_WIDTH = BUTTON * 2 + BUTTON_GAP * 2;
const MARQUEE_PASSES_AT_REST = 1;

export const SIDEBAR_PLAYER_HEIGHT = ROW_HEIGHT + 8;

export function useSidebarPlayerTab(windowId: string, profileId: string): string | undefined {
  const sessions = useMedia(useShallow((m) => Object.keys(m.sessions)));
  const hidden = useHiddenPlayerTabs(windowId, profileId, sessions);
  const candidates = useMedia(useShallow((m) => hidden.filter((id) => !m.leftPaused[id])));
  const shown = useRef<string | undefined>(undefined);
  shown.current = useMedia((m) => playerTabFor(m, candidates, shown.current));
  return shown.current;
}

const isLive = (session: Session) => session.duration === null;

export function SidebarPlayer({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const media = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const playing = isPlaying(session);
  const { hovered, hoverProps } = useHover();
  const artwork = useArtwork(tabId, session?.artwork);
  const title = session?.title || tab?.title || "";
  const marquee = useMarqueeGroup(title, hovered ? -1 : MARQUEE_PASSES_AT_REST);
  if (!session || !tab) return null;
  const go = () => switchToTab(tabId);

  return (
    <View {...hoverProps} style={{ height: ROW_HEIGHT }}>
      <Surface
        fill={hex(tokens.groupFill)}
        cornerRadius={radius.panel}
        borderColor={hex(tokens.groupStroke)}
        borderWidth={0.5}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: ROW_INSET, paddingRight: TRAILING_INSET }}
      >
        <Pressable onPress={go} style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", marginRight: TRAILING_INSET }}>
          <View tooltip="Back to Tab" style={{ width: ART, height: ART, borderRadius: radius.m, overflow: "hidden", backgroundColor: media.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
            {artwork ? <Image source={{ uri: artwork }} resizeMode="cover" style={{ width: ART, height: ART }} /> : <Favicon url={tab.url} favicon={tab.favicon} size={16} profileId={tab.profileId} />}
          </View>
          {isLive(session) ? <View accessibilityLabel="Live" style={{ width: LIVE_DOT, height: LIVE_DOT, borderRadius: LIVE_DOT / 2, marginLeft: 7, backgroundColor: theme.destructive }} /> : null}
          {tab.muted ? <Symbol name="speaker.slash.fill" size={9} color={theme.textSecondary} style={{ width: 13, height: 12, marginLeft: 6 }} /> : null}
          <View style={{ flex: 1, minWidth: 0, marginLeft: 6, marginRight: hovered ? HOVER_BUTTONS_WIDTH : 0 }}>
            <Marquee id="title" text={title} group={marquee} height={TITLE_HEIGHT} style={{ ...font.small, fontWeight: weight.semibold, color: theme.textPrimary }} />
          </View>
        </Pressable>
        {hovered ? (
          <View style={{ position: "absolute", top: 0, bottom: 0, right: TRAILING_INSET + BUTTON + BUTTON_GAP, flexDirection: "row", alignItems: "center", gap: BUTTON_GAP }}>
            <Button variant="icon" icon="xmark" size={11} box={BUTTON} radius={radius.m} tooltip="Close Player" onPress={() => dismissPlayer(tabId)} />
            <Button variant="icon"
              icon={tab.muted ? "speaker.slash.fill" : "speaker.wave.2.fill"}
              size={12}
              box={BUTTON}
              radius={radius.m}
              tooltip={tab.muted ? "Unmute Site" : "Mute Site"}
              onPress={() => toggleMute(tabId)}
            />
          </View>
        ) : null}
        <Button variant="icon" icon={playing ? "pause.fill" : "play.fill"} size={13} box={BUTTON} radius={radius.m} tooltip={playing ? "Pause" : "Play"} onPress={() => mediaCommand(tabId, "toggle")} />
      </Surface>
    </View>
  );
}
