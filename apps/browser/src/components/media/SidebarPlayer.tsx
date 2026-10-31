import { Panel, Symbol, Button, useHover } from "../ui";
import { useShallow } from "zustand/react/shallow";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, View } from "react-native";
import { switchToTab, toggleMute } from "../../state/browser/actions";
import { useTheme } from "../ui/theme";
import { curve, duration } from "../ui/motion";
import { font, radius, weight } from "../ui/tokens";
import { useTab } from "../../state/browser/hooks";
import { useMuteState } from "../../state/tabs/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { Favicon } from "../favicon/Favicon";
import { useSidebarTokens } from "../sidebar/tokens";
import { useArtwork } from "../../state/media/artwork";
import {
  dismissPlayer,
  isPlaying,
  mediaCommand,
  playerTabFor,
  skipOrTrack,
  transportIcons,
  useHiddenPlayerTabs,
  useMedia,
  usePictureInPicture,
  useSession,
  useTicker,
  type Session,
} from "../../state/media/media";
import { hostOf } from "@ardia/core";
import { Marquee, useMarqueeGroup } from "./Marquee";
import { TimeBar } from "./MiniPlayer";
import { useMediaTokens } from "./tokens";

const ROW_HEIGHT = 40;
const ROW_INSET = 6;
const TRAILING_INSET = 4;
const ART = 28;
const LIVE_DOT = 6;
const BUTTON = 24;
const PLAY_BUTTON = 28;
const TITLE_HEIGHT = 16;
const ARTIST_HEIGHT = 14;
const SEEK_ROW = 18;
const CONTROLS_ROW = 32;
const CONTROLS_GAP = 6;
const EXPANDED_BOTTOM = 4;
const EXPANDED_HEIGHT = ROW_HEIGHT + SEEK_ROW + CONTROLS_ROW + EXPANDED_BOTTOM;
const EXPAND_DELAY_MS = 250;
const COLLAPSE_DELAY_MS = 160;
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

function useExpanded(hovered: boolean, held: boolean) {
  const want = hovered || held;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (want === expanded) return;
    const timer = setTimeout(() => setExpanded(want), want ? EXPAND_DELAY_MS : COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [want, expanded]);
  const reveal = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (expanded) setMounted(true);
    const run = Animated.timing(reveal, { toValue: expanded ? 1 : 0, duration: duration.toggle, easing: curve.fold, useNativeDriver: false });
    run.start(({ finished }) => finished && !expanded && setMounted(false));
    return () => run.stop();
  }, [expanded]);
  return { expanded, mounted: want || mounted, reveal };
}

function PlayButton({ tabId, playing, box, size }: { tabId: string; playing: boolean; box: number; size: number }) {
  return <Button variant="icon" icon={playing ? "pause.fill" : "play.fill"} size={size} box={box} radius={radius.m} tooltip={playing ? "Pause" : "Play"} onPress={() => mediaCommand(tabId, "toggle")} />;
}

const PlayerControls = memo(function PlayerControls({ tabId, reveal, onSeeking }: { tabId: string; reveal: Animated.Value; onSeeking: (seeking: boolean) => void }) {
  const media = useMediaTokens();
  const session = useSession(tabId);
  const mute = useMuteState(tabId);
  const playing = isPlaying(session);
  const video = useMedia((m) => !!m.sessions[tabId]?.hasVideo || !!m.pipOpen[tabId]);
  const [pip, togglePip] = usePictureInPicture(tabId);
  useTicker(playing);
  if (!session) return null;
  const icons = transportIcons(session);
  return (
    <Animated.View style={{ opacity: reveal, paddingHorizontal: ROW_INSET + 2 }}>
      <View style={{ height: SEEK_ROW }}>
        <TimeBar tabId={tabId} session={session} tokens={media} trailing="total" onDragging={onSeeking} />
      </View>
      <View style={{ height: CONTROLS_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Button variant="icon" icon={mute ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={12} box={BUTTON} radius={radius.m} tooltip={muteTitle(mute)} onPress={() => toggleMute(tabId)} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: CONTROLS_GAP }}>
          <Button variant="icon" icon={icons.back} size={13} box={BUTTON} radius={radius.m} tooltip={icons.backTip} onPress={() => skipOrTrack(tabId, session, "back")} />
          <PlayButton tabId={tabId} playing={playing} box={PLAY_BUTTON} size={16} />
          <Button variant="icon" icon={icons.ahead} size={13} box={BUTTON} radius={radius.m} tooltip={icons.aheadTip} onPress={() => skipOrTrack(tabId, session, "ahead")} />
        </View>
        {video ? (
          <Button variant="icon" icon={pip ? "pip.exit" : "pip.enter"} size={13} box={BUTTON} radius={radius.m} tooltip={pip ? "Exit Picture in Picture" : "Picture in Picture"} onPress={togglePip} />
        ) : (
          <View style={{ width: BUTTON }} />
        )}
      </View>
    </Animated.View>
  );
});

const PlayerRow = memo(function PlayerRow({ tabId, mounted, hovered, reveal }: { tabId: string; mounted: boolean; hovered: boolean; reveal: Animated.Value }) {
  const theme = useTheme();
  const media = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const mute = useMuteState(tabId);
  const artwork = useArtwork(tabId, session?.artwork);
  const artistHeight = useMemo(() => reveal.interpolate({ inputRange: [0, 1], outputRange: [0, ARTIST_HEIGHT] }), [reveal]);
  const title = session?.title || tab?.title || "";
  const artist = session?.artist || (tab ? hostOf(tab.url) : "");
  const marquee = useMarqueeGroup(`${title}|${artist}`, hovered ? -1 : MARQUEE_PASSES_AT_REST);
  if (!session || !tab) return null;
  return (
    <Pressable onPress={() => switchToTab(tabId)} style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", marginRight: TRAILING_INSET }}>
      <View tooltip="Back to Tab" style={{ width: ART, height: ART, borderRadius: radius.m, overflow: "hidden", backgroundColor: media.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
        {artwork ? <Image source={{ uri: artwork }} resizeMode="cover" style={{ width: ART, height: ART }} /> : <Favicon url={tab.url} favicon={tab.favicon} size={16} profileId={tab.profileId} />}
      </View>
      {isLive(session) ? <View accessibilityLabel="Live" style={{ width: LIVE_DOT, height: LIVE_DOT, borderRadius: LIVE_DOT / 2, marginLeft: 7, backgroundColor: theme.destructive }} /> : null}
      {mute ? <Symbol name="speaker.slash.fill" size={9} color={theme.textSecondary} style={{ width: 13, height: 12, marginLeft: 6 }} /> : null}
      <View style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
        <Marquee id="title" text={title} group={marquee} height={TITLE_HEIGHT} style={{ ...font.small, fontWeight: weight.semibold, color: theme.textPrimary }} />
        {mounted && artist ? (
          <Animated.View style={{ height: artistHeight, opacity: reveal, overflow: "hidden" }}>
            <Marquee id="artist" text={artist} group={marquee} height={ARTIST_HEIGHT} style={{ ...font.caption, color: theme.textSecondary }} />
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
  );
});

export function SidebarPlayer({ tabId }: { tabId: string }) {
  const tokens = useSidebarTokens();
  const session = useSession(tabId);
  const shown = useTab(tabId) !== undefined;
  const playing = isPlaying(session);
  const { hovered, hoverProps } = useHover();
  const [seeking, setSeeking] = useState(false);
  const { expanded, mounted, reveal } = useExpanded(hovered, seeking);
  const height = useMemo(() => reveal.interpolate({ inputRange: [0, 1], outputRange: [ROW_HEIGHT, EXPANDED_HEIGHT] }), [reveal]);
  if (!session || !shown) return null;

  return (
    <Animated.View {...hoverProps} style={{ height }}>
      <Panel fill={tokens.groupFill} radius={radius.panel} border={tokens.groupStroke} style={{ flex: 1, overflow: "hidden" }}>
        <View style={{ height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: ROW_INSET, paddingRight: TRAILING_INSET }}>
          <PlayerRow tabId={tabId} mounted={mounted} hovered={hovered} reveal={reveal} />
          {expanded ? (
            <Button variant="icon" icon="xmark" size={11} box={BUTTON} radius={radius.m} tooltip="Close Player" onPress={() => dismissPlayer(tabId)} />
          ) : (
            <PlayButton tabId={tabId} playing={playing} box={BUTTON} size={13} />
          )}
        </View>
        {mounted ? <PlayerControls tabId={tabId} reveal={reveal} onSeeking={setSeeking} /> : null}
      </Panel>
    </Animated.View>
  );
}
