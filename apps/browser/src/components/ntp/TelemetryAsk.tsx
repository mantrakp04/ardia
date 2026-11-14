import { useEffect, useState } from "react";
import { Text as Span, View } from "react-native";
import { useDefaultBrowserCheckIn } from "../../state/onboarding/defaultBrowserCheckIn";
import { useWindow } from "../../state/browser/hooks";
import { dismissAsk, setSharing, useTelemetry, type AskPlacement } from "../../state/telemetry/client";
import { space } from "../ui/tokens";
import type { Frame } from "./NewTabExtras";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { onboardingCompletedAt, useOnboarding } from "../../state/onboarding/onboarding";
import { Box, Button, IconTile, lineHeight, Text } from "../ui";
import { NtpCard, NtpCardSlot, NtpCardSurface, NtpCardTitle, useCardRetire } from "./NtpCard";
import { useNtpColors } from "./tokens";
import { openSettings } from "../../state/settings/settingsWindows";
import { usePendingReleaseNotes } from "../../state/releaseNotes/releaseNotes";

const FRAME = { width: 300, estimatedHeight: 118, clearOfBar: space.xxxl };

let shownTabs = 0;

const placement = (): AskPlacement => ({ ask_place: "new_tab_corner", ask_shown_tabs: shownTabs });

function clearOfBar(size: { width: number; height: number }, bar: Frame, height: number) {
  const top = size.height - space.m - height;
  const right = space.m + FRAME.width;
  return bar.x >= right + FRAME.clearOfBar || bar.y + bar.height + FRAME.clearOfBar <= top;
}

export function TelemetryAsk({ windowId, size, bar }: { windowId: string; size: { width: number; height: number }; bar: Frame }) {
  const due = useTelemetry((s) => !s.decided && !s.askDone);
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const onboarding = useOnboarding((s) => s.windowId !== null);
  const checkIn = useDefaultBrowserCheckIn(windowId).visible;
  const releaseNotes = usePendingReleaseNotes() !== null;
  const [existing] = useState(() => onboardingCompletedAt() !== null);
  const [leaving, retire] = useCardRetire();
  const [height, setHeight] = useState<number>(FRAME.estimatedHeight);
  const asking = due && existing && !incognito && !onboarding && !checkIn && !releaseNotes;
  const room = clearOfBar(size, bar, height);
  const shown = !!leaving || (asking && room);
  useEffect(() => {
    if (shown && !leaving) shownTabs++;
  }, [shown]);
  if (!shown) return null;
  return (
    <NtpCardSlot width={FRAME.width} edge="bottom">
      <Card
        leaving={leaving}
        onLayout={setHeight}
        onShare={() => retire(() => setSharing(true, "ask", placement()))}
        onNotNow={() => retire(() => setSharing(false, "ask"))}
        onClose={() => retire(dismissAsk)}
      />
    </NtpCardSlot>
  );
}

function Card({
  leaving,
  onLayout,
  onShare,
  onNotNow,
  onClose,
}: {
  leaving: null | (() => void);
  onLayout: (height: number) => void;
  onShare: () => void;
  onNotNow: () => void;
  onClose: () => void;
}) {
  const colors = useNtpColors();
  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.height)}>
      <NtpCard appearDelay={600} leaving={leaving} onClose={onClose}>
        <NtpCardSurface />
        <Box pad="l" gap="l">
          <Box row gap="ml">
            <IconTile symbol="stethoscope" size="m" fill={colors.badge} glyph={colors.badgeGlyph} />
            <Box gap="xxs" style={FILL}>
              <NtpCardTitle>{SHARING_COPY.ask.title}</NtpCardTitle>
              <Text size="caption" style={{ lineHeight: lineHeight.caption, color: colors.body }}>
                {SHARING_COPY.ask.body}{" "}
                <Span onPress={() => openSettings("privacy")} style={LINK} accessibilityRole="link">
                  {SHARING_COPY.whatsSent}
                </Span>
              </Text>
            </Box>
          </Box>
          <Box row gap="m">
            <AskButton title={SHARING_COPY.ask.notNow} onPress={onNotNow} />
            <AskButton title={SHARING_COPY.ask.share} onPress={onShare} />
          </Box>
        </Box>
      </NtpCard>
    </View>
  );
}

function AskButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <View style={FILL}>
      <Button variant="pill" tone="prompt" title={title} onPress={onPress} />
    </View>
  );
}

const FILL = { flex: 1 } as const;
const LINK = { textDecorationLine: "underline" } as const;
