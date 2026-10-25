import { ContextMenuArea, hapticTick, showMenu } from "@ardia/shell";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { profileAccent, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { profileInitial } from "../icons/classify";
import { IconGlyph } from "../icons/IconGlyph";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { springParams } from "../layout/swipeMotion";
import { useHover } from "../primitives";
import { openProfileMenu } from "../ProfileIndicator";
import { openSettings } from "../settings/windows";
import { cylinderPoint, cylinderPosition, cylinderSamples } from "./cylinder";
import {
  DIAL_BAND,
  DIAL_BAND_TOP,
  DIAL_FACE_REACH,
  DIAL_GLYPH_BOX,
  DIAL_GLYPH_SIZE,
  DIAL_MAGNIFY,
  DIAL_MAGNIFY_SPREAD,
  DIAL_GLYPH_PILL,
  DIAL_GLYPH_Y,
  DIAL_MIN_ROOM,
  DIAL_NAME_HEIGHT,
  DIAL_NAME_TOP,
  DIAL_PITCH,
  DIAL_RADIUS,
  PROFILE_SWITCHER_HEIGHT,
  dialDrag,
  dialIndexAt,
  moveTo,
  reorderTarget,
} from "./dial";

export { PROFILE_SWITCHER_HEIGHT } from "./dial";

const DOT_CELL = 12;
const DOT = 6;
const DOT_BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const GLYPH_HOVERED = 0.85;
const GLYPH_IDLE = 0.55;
const LIFT_SCALE = 1.18;
const EDGE_FADE = 40;
const EDGE_INSET = 4;
const SETTLE_DELAY = 700;

const springTo = (value: Animated.Value, to: number) =>
  Animated.spring(value, { toValue: to, ...springParams(0.22, 0.9), useNativeDriver: true }).start();

export function useProfileSwitcherShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function ProfileDial({ windowId, width, leftRoom, rightRoom }: { windowId: string; width: number; leftRoom: number; rightRoom: number }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const current = useBrowser((s) => s.windows[windowId]?.profileId ?? "");
  const icons = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]?.icon ?? null)));
  const names = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]?.name ?? "")));
  const accents = useBrowser(useShallow((s) => s.profileOrder.map((id) => profileAccent(s.profiles[id]))));
  const index = Math.max(0, ids.indexOf(current));
  const room = width - leftRoom - rightRoom;
  if (room < DIAL_MIN_ROOM) return <CompactDots windowId={windowId} ids={ids} names={names} />;
  return <Tuner windowId={windowId} ids={ids} icons={icons} names={names} accents={accents} index={index} leftRoom={leftRoom} room={room} />;
}

function Tuner({
  windowId,
  ids,
  icons,
  names,
  accents,
  index,
  leftRoom,
  room,
}: {
  windowId: string;
  ids: string[];
  icons: (string | null)[];
  names: string[];
  accents: string[];
  index: number;
  leftRoom: number;
  room: number;
}) {
  const theme = useTheme();
  const band = useRef<View>(null);
  const position = useRef(new Animated.Value(index)).current;
  const appear = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstIndex = useRef(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const [preview, setPreview] = useState<number | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const indexRef = useRef(index);
  indexRef.current = index;
  const drag = useRef({ mode: null as null | "tune" | "reorder", id: "", from: 0, to: 0, dx: 0 }).current;
  const previewRef = useRef<number | null>(null);
  const pressedId = useRef<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const altDown = useRef(false);
  const reveal = (linger = 1200) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    Animated.timing(appear, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (linger > 0) hideSoon(linger);
  };
  const hideSoon = (delay = 1200) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      if (drag.mode) return;
      Animated.timing(appear, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }, delay);
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const hideRef = useRef(hideSoon);
  hideRef.current = hideSoon;
  useEffect(() => {
    if (firstIndex.current) {
      firstIndex.current = false;
      return;
    }
    revealRef.current(0);
    hideRef.current(1200);
  }, [index]);
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);
  useEffect(() => {
    if (!__DEV__) return;
    devBands.set(windowId, band);
    return () => {
      if (devBands.get(windowId) === band) devBands.delete(windowId);
      devPositions.delete(windowId);
    };
  }, [windowId]);
  useLayoutEffect(() => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (drag.mode === "tune") return;
    previewRef.current = null;
    setPreview(null);
    devPosition(windowId, index);
    springTo(position, index);
  }, [index, position, windowId]);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const offsetOf = (id: string) => {
    let value = offsets.get(id);
    if (!value) offsets.set(id, (value = new Animated.Value(0)));
    return value;
  };

  const setPosition = (value: number) => {
    position.setValue(value);
    devPosition(windowId, value);
  };

  const begin = (id: string) => {
    const from = idsRef.current.indexOf(id);
    if (from < 0) return;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressedId.current = null;
    Object.assign(drag, { mode: "reorder", id, from, to: from, dx: 0 });
    setLifted(id);
    setPreview(null);
    previewRef.current = null;
    reveal(0);
    hapticTick();
  };

  const move = (dx: number, dy: number) => {
    const count = idsRef.current.length;
    if (drag.mode === "reorder") {
      if (Math.abs(dy) > 20) return finish(false);
      const offset = Math.max(-(count - 1) * DIAL_PITCH - 6, Math.min((count - 1) * DIAL_PITCH + 6, dx));
      drag.dx = offset;
      offsetOf(drag.id).setValue(offset);
      const to = reorderTarget(drag.from, offset, count);
      if (to !== drag.to) {
        drag.to = to;
        hapticTick();
        idsRef.current.forEach((other, j) => {
          if (other === drag.id) return;
          springTo(offsetOf(other), drag.from < j && j <= to ? -DIAL_PITCH : to <= j && j < drag.from ? DIAL_PITCH : 0);
        });
      }
      return;
    }
    if (drag.mode !== "tune") return;
    const clamped = dialDrag(dx, indexRef.current, count);
    drag.dx = clamped;
    setPosition(cylinderPosition(indexRef.current, clamped));
    const next = dialIndexAt(clamped, indexRef.current, count);
    if (next !== previewRef.current) {
      previewRef.current = next;
      setPreview(next);
      hapticTick();
    }
  };

  const finish = (commit: boolean) => {
    const mode = drag.mode;
    drag.mode = null;
    longPressed.current = false;
    altDown.current = false;
    if (mode === "tune") {
      const from = indexRef.current;
      const to = previewRef.current ?? from;
      if (commit && to !== from) {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          previewRef.current = null;
          setPreview(null);
          devPosition(windowId, indexRef.current);
          springTo(position, indexRef.current);
        }, SETTLE_DELAY);
        switchProfile(windowId, idsRef.current[to]!, true);
      } else {
        previewRef.current = null;
        setPreview(null);
        devPosition(windowId, from);
        springTo(position, from);
      }
    } else if (mode === "reorder") {
      const { id, from, to } = drag;
      setLifted(null);
      if (commit && from !== to) useBrowser.getState().reorderProfiles(moveTo(idsRef.current, id, to));
      offsets.forEach((value) => {
        value.stopAnimation();
        value.setValue(0);
      });
    }
    drag.dx = 0;
    hideRef.current(900);
  };

  const api = useRef({ begin, move, finish });
  api.current = { begin, move, finish };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const alt = altDown.current || !!(event.nativeEvent as { altKey?: boolean }).altKey;
          revealRef.current(0);
          if (drag.mode !== "reorder" && alt) {
            api.current.begin(pressedId.current ?? idsRef.current[indexRef.current]!);
          }
          if (drag.mode !== "reorder") {
            drag.mode = "tune";
            drag.dx = 0;
            previewRef.current = indexRef.current;
            setPreview(indexRef.current);
            position.stopAnimation();
          }
        },
        onPanResponderMove: (_, gesture) => api.current.move(gesture.dx, gesture.dy),
        onPanResponderRelease: () => api.current.finish(true),
        onPanResponderTerminate: () => api.current.finish(false),
      }),
    [drag],
  );

  const press = (id: string, at: number) => {
    altDown.current = false;
    pressedId.current = null;
    if (longPressed.current) {
      longPressed.current = false;
      drag.mode = null;
      setLifted(null);
      hideRef.current(900);
      return;
    }
    if (at === indexRef.current) void openProfileMenu(windowId);
    else switchProfile(windowId, id, true);
  };

  const hold = (id: string) => {
    longPressed.current = true;
    api.current.begin(id);
  };

  const active = preview ?? index;

  return (
    <View style={{ height: PROFILE_SWITCHER_HEIGHT, width: leftRoom + room }}>
      <View
        {...pan.panHandlers}
        ref={band}
        style={{
          position: "absolute",
          left: leftRoom,
          top: DIAL_BAND_TOP,
          width: room,
          height: DIAL_BAND,
          overflow: "hidden",
        }}
      >
        {ids.map((id, i) => (
          <Slot
            key={id}
            slot={i}
            left={room / 2 - DIAL_PITCH / 2}
            name={names[i] ?? ""}
            icon={icons[i] ?? null}
            accent={accents[i] ?? "#8E8E93"}
            active={i === active}
            lifted={lifted === id}
            position={position}
            room={room}
            offset={offsetOf(id)}
            onPress={() => press(id, i)}
            onLongPress={() => hold(id)}
            onPressIn={(alt) => {
              altDown.current = alt;
              pressedId.current = id;
              if (pressTimer.current) clearTimeout(pressTimer.current);
              pressTimer.current = setTimeout(() => {
                pressTimer.current = null;
                pressedId.current = null;
              }, 1200);
              revealRef.current(1400);
            }}
            onMove={(delta) => useBrowser.getState().moveProfile(id, delta)}
            onMenu={() => void openSlotMenu(windowId, id)}
          />
        ))}
      </View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: leftRoom,
          top: DIAL_NAME_TOP,
          width: room,
          height: DIAL_NAME_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          opacity: appear,
        }}
      >
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: room, fontSize: 11, fontWeight: "600", color: theme.textPrimary }}>
          {names[active] ?? ""}
        </Text>
      </Animated.View>
    </View>
  );
}

function Slot({
  slot,
  left,
  name,
  icon,
  accent,
  active,
  lifted,
  position,
  room,
  offset,
  onPress,
  onLongPress,
  onPressIn,
  onMove,
  onMenu,
}: {
  slot: number;
  left: number;
  name: string;
  icon: string | null;
  accent: string;
  active: boolean;
  lifted: boolean;
  position: Animated.Value;
  room: number;
  offset: Animated.Value;
  onPress(): void;
  onLongPress(): void;
  onPressIn(alt: boolean): void;
  onMove(delta: -1 | 1): void;
  onMenu(): void;
}) {
  const theme = useTheme();
  const ink = theme.dark ? "#FFFFFF" : "#000000";
  const { hovered, hoverProps } = useHover();
  const samples = useMemo(() => cylinderSamples(slot, slot - DIAL_FACE_REACH, slot + DIAL_FACE_REACH), [slot]);
  const scaleSamples = useMemo(() => samples.input.map((rest) => cylinderPoint(slot, rest).scale), [samples, slot]);
  const dx = useMemo(() => position.interpolate({ inputRange: samples.input, outputRange: samples.dx, extrapolate: "clamp" }), [position, samples]);
  const scaleX = useMemo(() => position.interpolate({ inputRange: samples.input, outputRange: scaleSamples, extrapolate: "clamp" }), [position, samples, scaleSamples]);
  const edge = useMemo(
    () =>
      samples.input.map((rest) => {
        const x = Math.abs(cylinderPoint(slot, rest).x);
        return Math.max(0, Math.min(1, (room / 2 - EDGE_INSET - x) / EDGE_FADE));
      }),
    [samples, slot, room],
  );
  const opacity = useMemo(
    () => position.interpolate({ inputRange: samples.input, outputRange: samples.input.map((_, i) => (samples.opacity[i] ?? 0) * (edge[i] ?? 0)), extrapolate: "clamp" }),
    [position, samples, edge],
  );
  const magnify = useMemo(
    () =>
      position.interpolate({
        inputRange: samples.input,
        outputRange: samples.input.map((rest) => 1 + DIAL_MAGNIFY * Math.exp(-(((slot - rest) / DIAL_MAGNIFY_SPREAD) ** 2))),
        extrapolate: "clamp",
      }),
    [position, samples, slot],
  );
  const glyphScale = useMemo(() => Animated.multiply(magnify, lifted ? LIFT_SCALE : 1), [magnify, lifted]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left,
        top: 0,
        width: DIAL_PITCH,
        height: DIAL_BAND,
        opacity,
        zIndex: lifted ? 2 : 0,
        transform: [{ translateX: Animated.add(dx, offset) }, { scaleX }],
      }}
    >
      <View {...hoverProps} tooltip={name}>
        <ContextMenuArea onContextMenu={onMenu}>
          <Pressable
            style={{ width: DIAL_PITCH, height: DIAL_GLYPH_BOX }}
            accessibilityRole="button"
            accessibilityLabel={name}
            accessibilityHint="Click to switch. Drag to tune. Option-drag or hold to reorder."
            accessibilityActions={[
              { name: "moveLeft", label: "Move Left" },
              { name: "moveRight", label: "Move Right" },
            ]}
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName;
              if (action === "moveLeft") onMove(-1);
              else if (action === "moveRight") onMove(1);
            }}
            onPress={onPress}
            onLongPress={onLongPress}
            onPressIn={(event) => onPressIn(!!(event.nativeEvent as { altKey?: boolean }).altKey)}
            delayLongPress={350}
          >
            <View pointerEvents="none" style={{ width: DIAL_PITCH, height: DIAL_GLYPH_BOX, alignItems: "center", justifyContent: "center", opacity: active ? 1 : hovered ? GLYPH_HOVERED : GLYPH_IDLE }}>
              <View
                style={{
                  width: DIAL_GLYPH_PILL,
                  height: DIAL_GLYPH_PILL,
                  borderRadius: DIAL_GLYPH_PILL / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: lifted ? `${accent}33` : undefined,
                }}
              >
                <Animated.View style={{ transform: [{ scale: glyphScale }] }}>
                  <IconGlyph icon={icon} initial={profileInitial(name)} size={DIAL_GLYPH_SIZE} color={ink} monochrome={!active} />
                </Animated.View>
              </View>
            </View>
            <Text style={{ position: "absolute", left: 0, top: 0, width: DIAL_PITCH, height: DIAL_GLYPH_BOX, color: "transparent" }}>{"\u200B"}</Text>
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

function CompactDots({ windowId, ids, names }: { windowId: string; ids: string[]; names: string[] }) {
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_SWITCHER_HEIGHT, alignItems: "center", justifyContent: "center" }}>
      <View style={{ height: DOT_BAND, flexDirection: "row" }}>
        {ids.map((id, i) => (
          <CompactDot key={id} id={id} name={names[i] ?? ""} windowId={windowId} page={pages.find((page) => page.id === id)} pos={pager.pos} />
        ))}
      </View>
    </View>
  );
}

function CompactDot({ id, name, windowId, page, pos }: { id: string; name: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
        <View style={{ width: DOT_CELL, height: DOT_BAND, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.dark ? "#FFFFFF" : "#000000", opacity }} />
        </View>
      </Pressable>
    </View>
  );
}

async function openSlotMenu(windowId: string, id: string) {
  const s = useBrowser.getState();
  const from = s.profileOrder.indexOf(id);
  const isDefault = s.settings.defaultProfileId === id;
  const choice = await showMenu([
    { id: "switch", title: "Switch to Profile", enabled: id !== s.windows[windowId]?.profileId },
    { id: "icon", title: "Change Icon…", symbol: "face.smiling" },
    { id: "edit", title: "Edit Profile…", symbol: "pencil" },
    { id: "default", title: "Make Default Profile", enabled: !isDefault },
    { separator: true },
    { id: "left", title: "Move Left", enabled: from > 0 },
    { id: "right", title: "Move Right", enabled: from >= 0 && from < s.profileOrder.length - 1 },
  ]);
  if (!choice) return;
  if (choice === "switch") switchProfile(windowId, id, true);
  else if (choice === "icon" || choice === "edit") openSettings("profiles", id);
  else if (choice === "default") s.setDefaultProfile(id);
  else if (choice === "left" || choice === "right") s.moveProfile(id, choice === "left" ? -1 : 1);
}

const devBands = new Map<string, RefObject<View | null>>();
const devPositions = new Map<string, number>();

function devPosition(windowId: string, value: number) {
  if (__DEV__) devPositions.set(windowId, value);
}

if (__DEV__) {
  (globalThis as { acDial?: unknown }).acDial = {
    info: (windowId: string) => {
      const s = useBrowser.getState();
      const ids = s.profileOrder;
      const index = Math.max(0, ids.indexOf(s.windows[windowId]?.profileId ?? ""));
      return {
        ids,
        index,
        position: devPositions.get(windowId) ?? index,
        pitch: DIAL_PITCH,
        radius: DIAL_RADIUS,
        footer: PROFILE_SWITCHER_HEIGHT,
        bandTop: DIAL_BAND_TOP,
        glyphY: DIAL_GLYPH_Y,
      };
    },
    rect: (windowId: string) =>
      new Promise((resolve) => {
        const ref = devBands.get(windowId);
        if (!ref?.current) return resolve(null);
        ref.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
      }),
    slotX: (windowId: string, slot: number) =>
      new Promise((resolve) => {
        const ref = devBands.get(windowId);
        if (!ref?.current) return resolve(null);
        ref.current.measureInWindow((x, _y, width) => {
          const s = useBrowser.getState();
          const index = Math.max(0, s.profileOrder.indexOf(s.windows[windowId]?.profileId ?? ""));
          resolve(x + width / 2 + cylinderPoint(slot, index).x);
        });
      }),
  };
}
