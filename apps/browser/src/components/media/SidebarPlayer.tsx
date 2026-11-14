import { Dot, Panel, Symbol, Button, tabularNums, Text, useHover, reduceMotion } from "../ui";
import { useShallow } from "zustand/react/shallow";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";
import { switchToTab, toggleMute } from "../../state/browser/actions";
import { layout, useTheme } from "../ui/theme";
import { buttonMotion, curve, duration, springs, usePressScaleMotion } from "../ui/motion";
import { font, radius, space, weight } from "../ui/tokens";
import { useTab } from "../../state/browser/hooks";
import { useMuteState } from "../../state/tabs/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { noteSidebarPlayerExpanded } from "../../state/telemetry/usage";
import { Favicon } from "../favicon/Favicon";
import { useSidebarTokens } from "../sidebar/tokens";
import { GlassFill, useGlass } from "../ui/Glass";
import { useArtwork } from "../../state/media/artwork";
import {
  dismissPlayer,
  formatTime,
  isPlaying,
  mediaCommand,
  playerTabFor,
  positionOf,
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
const ROW_INSET = space.s;
const TRAILING_INSET = space.xs;
const ART = 28;
const LIVE_DOT = 6;
const BUTTON = 24;
const TITLE_HEIGHT = 16;
const ARTIST_HEIGHT = 14;
const SEEK_ROW = 18;
const CONTROLS_ROW = 32;
const CONTROLS_GAP = space.s;
const EXPANDED_BOTTOM = space.xs;
const EXPANDED_HEIGHT = ROW_HEIGHT + SEEK_ROW + CONTROLS_ROW + EXPANDED_BOTTOM;
const GROWTH = EXPANDED_HEIGHT - ROW_HEIGHT;
const FIXED_BASE = ROW_HEIGHT / 2;
const SWAP_SCALE = 0.9;
const EXPAND_DELAY_MS = 60;
const COLLAPSE_DELAY_MS = 100;
const MARQUEE_PASSES_AT_REST = 1;
const REACH_ABOVE = space.m;
const REVEAL_SETTLE = { overshootClamping: true, restDisplacementThreshold: 0.002, restSpeedThreshold: 0.02, useNativeDriver: true } as const;
const REVEAL_SPRING = { open: { ...springs.reveal, ...REVEAL_SETTLE }, close: { ...springs.snappy, ...REVEAL_SETTLE } } as const;
const STILL_FADE = { duration: duration.base, easing: curve.fade, useNativeDriver: true } as const;
const RANGE = { artist: [0.25, 0.75], seek: [0.3, 0.6], transport: [0.55, 0.9], restTrailing: [0, 0.3], close: [0.3, 0.6] } as const;

export const SIDEBAR_PLAYER_HEIGHT = ROW_HEIGHT + 8;

export function SidebarPlayer({ tabId, docked }: { tabId: string; docked: boolean }) {
  const session = useSession(tabId);
  const shown = useTab(tabId) !== undefined;
  const playing = isPlaying(session);
  const { hovered, hoverProps } = useHover();
  const [seeking, setSeeking] = useState(false);
  const want = hovered || seeking;
  const { open, extended, armed, reveal } = useReveal(want);
  const styles = useRevealStyles(reveal, open, extended);
  if (!session || !shown) return null;

  return (
    <View {...hoverProps} pointerEvents="box-none" style={cellStyle(docked)}>
      <View style={{ height: extended ? EXPANDED_HEIGHT : ROW_HEIGHT }}>
        <View pointerEvents="box-none" style={cardFrame}>
          <CardFill lift={styles.lift} lit={hovered} />
          <Animated.View pointerEvents="box-none" style={[cardContent, styles.lift]}>
            <View style={{ height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: ROW_INSET, paddingRight: TRAILING_INSET }}>
              <PlayerRow tabId={tabId} hovered={hovered} revealing={want || extended} styles={styles} />
              <View style={{ justifyContent: "center" }}>
                <Animated.View pointerEvents={armed.rest ? "auto" : "none"} style={styles.restTrailing}>
                  {playing && session.duration ? <TimeLeft session={session} /> : <PlayButton tabId={tabId} playing={playing} size="m" hidden={!armed.rest} />}
                </Animated.View>
                {extended ? (
                  <Animated.View pointerEvents={armed.controls ? "auto" : "none"} style={[closeSlot, styles.close]}>
                    <Button variant="icon" icon="xmark" size="m" tooltip={armed.controls ? "Close Player" : undefined} onPress={() => dismissPlayer(tabId)} />
                  </Animated.View>
                ) : null}
              </View>
            </View>
            {want || extended ? <PlayerControls tabId={tabId} styles={styles} armed={armed.controls} onSeeking={setSeeking} /> : null}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const cellStyle = (docked: boolean) => ({
  marginTop: -REACH_ABOVE,
  paddingTop: REACH_ABOVE + (docked ? space.m : 0),
  paddingBottom: docked ? 0 : space.m,
  paddingHorizontal: layout.sidebarInset,
});

export function useSidebarPlayerTab(windowId: string, profileId: string): string | undefined {
  const sessions = useMedia(useShallow((m) => Object.keys(m.sessions)));
  const hidden = useHiddenPlayerTabs(windowId, profileId, sessions);
  const candidates = useMedia(useShallow((m) => hidden.filter((id) => !m.leftPaused[id])));
  const shown = useRef<string | undefined>(undefined);
  shown.current = useMedia((m) => playerTabFor(m, candidates, shown.current));
  return shown.current;
}

const cardFrame = { position: "absolute", left: 0, right: 0, bottom: 0, height: EXPANDED_HEIGHT, borderRadius: radius.panel, overflow: "hidden" } as const;
const cardContent = { position: "absolute", left: 0, right: 0, top: 0, height: EXPANDED_HEIGHT } as const;
const titleAlone = { transform: [{ translateY: ARTIST_HEIGHT / 2 }] };
const closeSlot = { position: "absolute", right: 0, top: 0, bottom: 0, justifyContent: "center" } as const;

const isLive = (session: Session) => session.duration === null;

function useReveal(want: boolean) {
  const reveal = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const [extended, setExtended] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (want === open) return;
    const reentered = want && extended;
    const timer = setTimeout(
      () => {
        setOpen(want);
        setSettled(false);
        if (want) {
          setExtended(true);
          noteSidebarPlayerExpanded(reentered);
        }
        revealMotion(reveal, want).start(({ finished }) => finished && (want ? setSettled(true) : setExtended(false)));
      },
      want ? (reentered ? 0 : EXPAND_DELAY_MS) : COLLAPSE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [want, open, extended]);
  useEffect(() => () => reveal.stopAnimation(), [reveal]);
  return { open, extended, armed: { controls: open && settled, rest: !extended }, reveal };
}

const revealMotion = (reveal: Animated.Value, open: boolean) =>
  reduceMotion()
    ? Animated.timing(reveal, { toValue: open ? 1 : 0, ...STILL_FADE })
    : Animated.spring(reveal, { toValue: open ? 1 : 0, ...(open ? REVEAL_SPRING.open : REVEAL_SPRING.close) });

const along = (reveal: Animated.Value, [from, to]: readonly [number, number], outputRange: number[]) =>
  reveal.interpolate({ inputRange: [from, to], outputRange, extrapolate: "clamp" });

function useRevealStyles(reveal: Animated.Value, open: boolean, extended: boolean) {
  const still = !!reduceMotion();
  return useMemo(() => {
    const moving = (range: readonly [number, number], outputRange: number[], shown: boolean) => (still ? outputRange[shown ? 1 : 0]! : along(reveal, range, outputRange));
    return {
      lift: { transform: [{ translateY: moving([0, 1], [GROWTH, 0], extended) }] },
      titleBlock: { transform: [{ translateY: moving([0, 1], [ARTIST_HEIGHT / 2, 0], extended) }] },
      artist: { opacity: along(reveal, RANGE.artist, [0, 1]) },
      seek: { opacity: along(reveal, RANGE.seek, [0, 1]) },
      transport: { opacity: along(reveal, RANGE.transport, [0, 1]) },
      restTrailing: { opacity: along(reveal, RANGE.restTrailing, [1, 0]), transform: [{ scale: moving(RANGE.restTrailing, [1, SWAP_SCALE], open) }] },
      close: { opacity: along(reveal, RANGE.close, [0, 1]), transform: [{ scale: moving(RANGE.close, [SWAP_SCALE, 1], open) }] },
    };
  }, [reveal, still, still && open, still && extended]);
}

type RevealStyles = ReturnType<typeof useRevealStyles>;

const CardFill = memo(function CardFill({ lift, lit }: { lift: RevealStyles["lift"]; lit: boolean }) {
  const tokens = useSidebarTokens();
  const glass = useGlass();
  const fill = glass ? (
    <GlassFill radius={radius.panel} state={lit ? "lit" : "rest"} />
  ) : (
    <Panel fill={lit ? tokens.groupFillEmphasized : tokens.groupFill} radius={radius.panel} border={tokens.groupStroke} style={StyleSheet.absoluteFill} />
  );
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: EXPANDED_HEIGHT - FIXED_BASE, overflow: "hidden" }}>
        <Animated.View style={[{ height: EXPANDED_HEIGHT }, lift]}>{fill}</Animated.View>
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: FIXED_BASE, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: EXPANDED_HEIGHT }}>{fill}</View>
      </View>
    </>
  );
});

function PlayButton({ tabId, playing, size, hidden }: { tabId: string; playing: boolean; size: "m" | "l"; hidden?: boolean }) {
  const tooltip = playing ? "Pause" : "Play";
  return <Button variant="icon" icon={playing ? "pause.fill" : "play.fill"} size={size} tooltip={hidden ? undefined : tooltip} onPress={() => mediaCommand(tabId, "toggle")} />;
}

function TimeLeft({ session }: { session: Session }) {
  const media = useMediaTokens();
  useTicker(true);
  const left = formatTime((session.duration ?? 0) - positionOf(session));
  return (
    <View accessibilityLabel={`${left} left`} style={{ height: BUTTON, minWidth: BUTTON, paddingHorizontal: space.xs, alignItems: "flex-end", justifyContent: "center" }}>
      <Text size="caption" color={media.secondary} style={tabularNums}>
        -{left}
      </Text>
    </View>
  );
}

const PlayerControls = memo(function PlayerControls({
  tabId,
  styles,
  armed,
  onSeeking,
}: {
  tabId: string;
  styles: RevealStyles;
  armed: boolean;
  onSeeking: (seeking: boolean) => void;
}) {
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
    <View pointerEvents="box-none" style={{ paddingHorizontal: ROW_INSET + 2 }}>
      <Animated.View pointerEvents={armed ? "auto" : "none"} style={[{ height: SEEK_ROW }, styles.seek]}>
        <TimeBar tabId={tabId} session={session} tokens={media} trailing="total" onDragging={onSeeking} />
      </Animated.View>
      <Animated.View pointerEvents={armed ? "auto" : "none"} style={[{ height: CONTROLS_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, styles.transport]}>
        <Button variant="icon" icon={mute ? "speaker.slash.fill" : "speaker.wave.2.fill"} size="m" tooltip={muteTitle(mute)} onPress={() => toggleMute(tabId)} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: CONTROLS_GAP }}>
          <Button variant="icon" icon={icons.back} size="m" tooltip={icons.backTip} onPress={() => skipOrTrack(tabId, session, "back")} />
          <PlayButton tabId={tabId} playing={playing} size="l" />
          <Button variant="icon" icon={icons.ahead} size="m" tooltip={icons.aheadTip} onPress={() => skipOrTrack(tabId, session, "ahead")} />
        </View>
        {video ? (
          <Button variant="icon" icon={pip ? "pip.exit" : "pip.enter"} size="m" tooltip={pip ? "Exit Picture in Picture" : "Picture in Picture"} onPress={togglePip} />
        ) : (
          <View style={{ width: BUTTON }} />
        )}
      </Animated.View>
    </View>
  );
});

const PlayerRow = memo(function PlayerRow({ tabId, hovered, revealing, styles }: { tabId: string; hovered: boolean; revealing: boolean; styles: RevealStyles }) {
  const theme = useTheme();
  const media = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const mute = useMuteState(tabId);
  const artwork = useArtwork(tabId, session?.artwork);
  const pressMotion = usePressScaleMotion(true, buttonMotion.controlPressScale);
  const artScaleStyle = pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : undefined;
  const title = session?.title || tab?.title || "";
  const artist = session?.artist || (tab ? hostOf(tab.url) : "");
  const marquee = useMarqueeGroup(`${title}|${artist}`, hovered ? -1 : MARQUEE_PASSES_AT_REST);
  if (!session || !tab) return null;
  return (
    <Pressable
      onPress={() => switchToTab(tabId)}
      onPressIn={pressMotion.onPressIn}
      onPressOut={pressMotion.onPressOut}
      style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", marginRight: TRAILING_INSET }}
    >
      <Animated.View tooltip="Back to Tab" style={artScaleStyle}>
        <View style={{ width: ART, height: ART, borderRadius: radius.control, overflow: "hidden", backgroundColor: media.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
          {artwork ? <Image source={{ uri: artwork }} resizeMode="cover" style={{ width: ART, height: ART }} /> : <Favicon url={tab.url} favicon={tab.favicon} size={16} profileId={tab.profileId} />}
        </View>
      </Animated.View>
      {isLive(session) ? (
        <View accessibilityLabel="Live" style={{ marginLeft: space.m }}>
          <Dot size={LIVE_DOT} color={theme.destructive} />
        </View>
      ) : null}
      {mute ? <Symbol name="speaker.slash.fill" size={9} color={theme.textSecondary} style={{ width: 13, height: 12, marginLeft: space.s }} /> : null}
      <Animated.View style={[{ flex: 1, minWidth: 0, height: TITLE_HEIGHT + ARTIST_HEIGHT, marginLeft: space.s }, artist ? styles.titleBlock : titleAlone]}>
        <Marquee id="title" text={title} group={marquee} height={TITLE_HEIGHT} style={{ ...font.small, fontWeight: weight.semibold, color: theme.textPrimary }} />
        {revealing && artist ? (
          <Animated.View style={styles.artist}>
            <Marquee id="artist" text={artist} group={marquee} height={ARTIST_HEIGHT} style={{ ...font.caption, color: theme.textSecondary }} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
});
