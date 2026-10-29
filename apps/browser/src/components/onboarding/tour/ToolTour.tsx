import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useWindowId } from "../../../state/browser/hooks";
import type { Rect } from "../../window/geometry";
import { Button, Panel, Surface, useHover, usePresence } from "../../ui";
import { useOnboardingColors } from "../Parts";
import { locateAnchor } from "./anchors";
import { endToolTour, openVideoTour, stepToolTour, useTour, videoTourUrl, type TourStop } from "../../../state/onboarding/tour";
import { curve } from "../../ui/motion";
import { font, radius, shadow, weight } from "../../ui/tokens";
import { onboardingMotion, onboardingType, tourRing } from "../tokens";

const CARD_WIDTH = 296;
const GAP = 14;
const MARGIN = 12;
const SCRIM_REACH = 6000;

const TOUR_PRESENCE = {
  show: { duration: onboardingMotion.tourIn, easing: curve.outQuad },
  hide: { duration: onboardingMotion.tourOut, easing: curve.inQuad },
};

export function ToolTour() {
  const windowId = useWindowId();
  const active = useTour((s) => s.windowId === windowId && s.stops.length > 0);
  const session = useTour((s) => s.session);
  const { shown, appear: presence } = usePresence(active ? session : null, TOUR_PRESENCE);

  if (shown === null) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: presence }]} pointerEvents={active ? "box-none" : "none"}>
      <Tour key={shown} windowId={windowId} />
    </Animated.View>
  );
}

type Hole = Rect & { radius: number };

function Tour({ windowId }: { windowId: string }) {
  const colors = useOnboardingColors();
  const stops = useTour((s) => s.stops);
  const index = useTour((s) => s.index);
  const stop = stops[Math.min(index, stops.length - 1)];
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [target, setTarget] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(150);
  const hole = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), w: new Animated.Value(0), h: new Animated.Value(0), r: new Animated.Value(0) }).current;
  const card = useRef({ x: new Animated.Value(0), y: new Animated.Value(0) }).current;
  const placed = useRef(false);

  useEffect(() => {
    if (!stop?.anchor) return setTarget(null);
    let cancelled = false;
    const update = () =>
      void locateAnchor(windowId, stop.anchor!).then((rect) => {
        if (!cancelled) setTarget((prev) => (sameRect(prev, rect) ? prev : rect));
      });
    update();
    const timer = setInterval(update, 400);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stop?.id, windowId]);

  const spot = spotlight(stop, target, size);
  const cardAt = placeCard(stop, spot, size, cardHeight);

  useEffect(() => {
    if (!size.width || !stop) return;
    const to = { x: spot.x, y: spot.y, w: spot.width, h: spot.height, r: spot.radius };
    const cardTo = { x: cardAt.x, y: cardAt.y };
    if (!placed.current) {
      placed.current = true;
      (Object.keys(to) as (keyof typeof to)[]).forEach((k) => hole[k].setValue(to[k]));
      card.x.setValue(cardTo.x);
      card.y.setValue(cardTo.y);
      return;
    }
    const spring = (v: Animated.Value, toValue: number) => Animated.spring(v, { toValue, friction: 10, tension: 70, useNativeDriver: false });
    Animated.parallel([
      ...(Object.keys(to) as (keyof typeof to)[]).map((k) => spring(hole[k], to[k])),
      spring(card.x, cardTo.x),
      spring(card.y, cardTo.y),
    ]).start();
  }, [spot.x, spot.y, spot.width, spot.height, spot.radius, cardAt.x, cardAt.y, size.width, !!stop]);

  if (!stop) return null;
  const scrim = colors.tourScrim;
  const holeRight = Animated.add(hole.x, hole.w);
  const holeBottom = Animated.add(hole.y, hole.h);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: Animated.subtract(hole.x, SCRIM_REACH),
          top: Animated.subtract(hole.y, SCRIM_REACH),
          width: Animated.add(hole.w, SCRIM_REACH * 2),
          height: Animated.add(hole.h, SCRIM_REACH * 2),
          borderWidth: SCRIM_REACH,
          borderRadius: Animated.add(hole.r, SCRIM_REACH),
          borderColor: scrim,
          overflow: "hidden",
        }}
      />
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, height: hole.y }} />
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: holeBottom, bottom: 0 }} />
      <Animated.View style={{ position: "absolute", left: 0, width: hole.x, top: hole.y, height: hole.h }} />
      <Animated.View style={{ position: "absolute", left: holeRight, right: 0, top: hole.y, height: hole.h }} />
      {stop.anchor ? <Ring hole={hole} /> : null}
      <Animated.View
        style={{ position: "absolute", left: card.x, top: card.y, width: CARD_WIDTH }}
        onLayout={(e) => setCardHeight(Math.round(e.nativeEvent.layout.height))}
      >
        <CoachMark stop={stop} index={index} count={stops.length} windowId={windowId} />
      </Animated.View>
    </View>
  );
}

const valueOf = (v: Animated.Value) => (v as unknown as { __getValue(): number }).__getValue();

function Ring({ hole }: { hole: { x: Animated.Value; y: Animated.Value; w: Animated.Value; h: Animated.Value; r: Animated.Value } }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [r, setR] = useState(() => valueOf(hole.r));
  useEffect(() => {
    const id = hole.r.addListener(({ value }) => setR(Math.max(0, value)));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: onboardingMotion.tourPulse, easing: curve.inOutSine, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: onboardingMotion.tourPulse, easing: curve.inOutSine, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      hole.r.removeListener(id);
    };
  }, []);
  const out = 3;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: Animated.subtract(hole.x, out),
        top: Animated.subtract(hole.y, out),
        width: Animated.add(hole.w, out * 2),
        height: Animated.add(hole.h, out * 2),
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]}>
        <Surface style={StyleSheet.absoluteFill} cornerRadius={r + out} borderWidth={1.5} borderColor={tourRing} />
      </Animated.View>
    </Animated.View>
  );
}

function CoachMark({ stop, index, count, windowId }: { stop: TourStop; index: number; count: number; windowId: string }) {
  const theme = useTheme();
  const last = index === count - 1;
  const video = last ? videoTourUrl() : null;
  return (
    <Panel fill={theme.panel} radius={radius.sheet} border={theme.panelBorder} shadow={shadow.dialog}>
      <View style={{ paddingHorizontal: 18, paddingTop: 15, paddingBottom: 14, gap: 7 }} accessibilityRole="none">
        <Text style={{ ...onboardingType.coachCount, color: theme.textTertiary }}>
          {`${index + 1} OF ${count}`}
        </Text>
        <Text style={{ ...onboardingType.coachTitle, color: theme.textPrimary }}>{stop.title}</Text>
        <Text style={{ ...onboardingType.bodyCompact, lineHeight: 18, color: theme.textSecondary }}>{stop.body}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 7, gap: 6 }}>
          {last ? null : <Button variant="text" plate="none" tone="textTertiary" hoverTone="textPrimary" padY="s" label="Skip Tour" title="Skip Tour" onPress={endToolTour} />}
          <View style={{ flex: 1 }} />
          {video ? <PillButton title="Watch Video Tour" onPress={() => (endToolTour(), openVideoTour(windowId))} /> : null}
          {index > 0 && !last ? <PillButton title="Back" onPress={() => stepToolTour(-1)} /> : null}
          <PillButton title={last ? "Done" : "Next"} primary onPress={() => stepToolTour(1)} />
        </View>
      </View>
    </Panel>
  );
}

function PillButton({ title, onPress, primary }: { title: string; onPress: () => void; primary?: boolean }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              height: 28,
              borderRadius: 14,
              paddingHorizontal: 13,
              justifyContent: "center",
              backgroundColor: primary ? (hovered ? colors.primaryHover : colors.primary) : hovered ? colors.buttonHover : colors.button,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            }}
          >
            <Text style={{ ...font.small, fontWeight: weight.semibold, color: primary ? colors.primaryText : colors.buttonText }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

function spotlight(stop: TourStop | undefined, target: Rect | null, size: { width: number; height: number }): Hole {
  if (!stop?.anchor || !target) return { x: size.width / 2, y: size.height / 2, width: 0, height: 0, radius: 0 };
  const pad = stop.pad ?? 4;
  return { x: target.x - pad, y: target.y - pad, width: target.width + pad * 2, height: target.height + pad * 2, radius: (stop.radius ?? 8) + Math.max(0, pad) };
}

function placeCard(stop: TourStop | undefined, spot: Hole, size: { width: number; height: number }, height: number) {
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, size.width - CARD_WIDTH - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, size.height - height - MARGIN));
  const centre = { x: clampX(size.width / 2 - CARD_WIDTH / 2), y: clampY(size.height * 0.62 - height / 2) };
  if (!stop?.anchor || !spot.width) return centre;
  switch (stop.placement) {
    case "right": {
      const x = spot.x + spot.width + GAP;
      if (x + CARD_WIDTH > size.width - MARGIN) return { x: clampX(spot.x), y: clampY(spot.y + spot.height + GAP) };
      return { x, y: clampY(spot.y + spot.height / 2 - 36) };
    }
    case "inside":
      return { x: clampX(spot.x + spot.width / 2 - CARD_WIDTH / 2), y: clampY(spot.y + spot.height * 0.7 - height / 2) };
    default: {
      const below = spot.y + spot.height + GAP;
      const y = below + height > size.height - MARGIN ? spot.y - GAP - height : below;
      const x = spot.width < CARD_WIDTH / 2 ? spot.x - 10 : spot.x + spot.width / 2 - CARD_WIDTH / 2;
      return { x: clampX(x), y: clampY(y) };
    }
  }
}
