import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { PreviewId } from "./previews";
import { space } from "../ui/tokens";
import { OptionCard } from "./OptionCard";
import { useOnboardingCard } from "./Parts";

const REPLAY_GAP = 280;
const REPLAY_LENGTH = 1700;

export type ChoiceOption<T> = { value: T; preview: PreviewId; title: string; subtitle: string };

export type MockFocus = { focus: PreviewId | null; hover: (id: PreviewId, on: boolean) => void; replay: (id: PreviewId) => void };

export function useMockFocus(resetKey: unknown): MockFocus {
  const [hovered, setHovered] = useState<PreviewId | null>(null);
  const [replaying, setReplaying] = useState<{ id: PreviewId; playing: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);
  useEffect(() => {
    clear();
    setHovered(null);
    setReplaying(null);
  }, [resetKey]);
  const [actions] = useState(() => ({
    hover: (id: PreviewId, on: boolean) => setHovered((current) => (on ? id : current === id ? null : current)),
    replay: (id: PreviewId) => {
      clear();
      setReplaying({ id, playing: false });
      timers.current = [
        setTimeout(() => setReplaying({ id, playing: true }), REPLAY_GAP),
        setTimeout(() => setReplaying(null), REPLAY_GAP + REPLAY_LENGTH),
      ];
    },
  }));
  const focus = replaying ? (replaying.playing ? replaying.id : null) : hovered;
  return { focus, ...actions };
}

export function ChoiceList<T extends string | number | boolean | null>({
  options,
  value,
  onChange,
  mock,
}: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  mock: MockFocus;
}) {
  const dense = useOnboardingCard().compact;
  return (
    <View style={{ gap: space.m, flexDirection: dense ? "row" : "column" }} accessibilityRole="radiogroup">
      {options.map((o) => (
        <View key={String(o.value)} style={dense ? { flex: 1 } : null}>
          <OptionCard
            control="radio"
            title={o.title}
            subtitle={dense ? undefined : o.subtitle}
            dense={dense}
            selected={o.value === value}
            onHover={(on) => mock.hover(o.preview, on)}
            onPress={() => {
              if (o.value !== value) onChange(o.value);
              mock.replay(o.preview);
            }}
          />
        </View>
      ))}
    </View>
  );
}
