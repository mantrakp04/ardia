import { useState } from "react";
import { Pressable, Text as Span, View } from "react-native";
import { useDefaultBrowserCheckIn } from "../../state/onboarding/defaultBrowserCheckIn";
import { useWindow } from "../../state/browser/hooks";
import { dismissAsk, setSharing, useTelemetry } from "../../state/telemetry/client";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { onboardingCompletedAt, useOnboarding } from "../../state/onboarding/onboarding";
import { Box, radius, Symbol, Text, useHover } from "../ui";
import { NtpCard, NtpCardSlot, NtpCardSurface, NtpCardTitle, useCardRetire } from "./NtpCard";
import { useNtpColors } from "./tokens";
import { openSettings } from "../../state/settings/settingsWindows";
import { usePendingReleaseNotes } from "../../state/releaseNotes/releaseNotes";

const FRAME = { width: 300 };
const BADGE = 30;
const BODY_LINE = 15;
const ASK_HEIGHT = 26;

export function TelemetryAsk({ windowId }: { windowId: string }) {
  const due = useTelemetry((s) => !s.decided && !s.askDone);
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const onboarding = useOnboarding((s) => s.windowId !== null);
  const checkIn = useDefaultBrowserCheckIn(windowId).visible;
  const releaseNotes = usePendingReleaseNotes() !== null;
  const [existing] = useState(() => onboardingCompletedAt() !== null);
  const [leaving, retire] = useCardRetire();
  if (!leaving && !(due && existing && !incognito && !onboarding && !checkIn && !releaseNotes)) return null;
  return (
    <NtpCardSlot width={FRAME.width}>
      <Card
        leaving={leaving}
        onShare={() => retire(() => setSharing(true, "ask"))}
        onNotNow={() => retire(() => setSharing(false, "ask"))}
        onClose={() => retire(dismissAsk)}
      />
    </NtpCardSlot>
  );
}

function Card({ leaving, onShare, onNotNow, onClose }: { leaving: null | (() => void); onShare: () => void; onNotNow: () => void; onClose: () => void }) {
  const colors = useNtpColors();
  return (
    <NtpCard appearDelay={600} leaving={leaving} onClose={onClose}>
      <NtpCardSurface />
      <Box pad="l" gap="l">
        <Box row gap="ml">
          <View style={[BADGE_PLATE, { backgroundColor: colors.badge }]}>
            <Symbol name="stethoscope" size={14} weight="medium" color={colors.badgeGlyph} style={BADGE_GLYPH} />
          </View>
          <Box gap="xxs" style={FILL}>
            <NtpCardTitle>{SHARING_COPY.ask.title}</NtpCardTitle>
            <Text size="footnote" style={{ lineHeight: BODY_LINE, color: colors.body }}>
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
  );
}

function AskButton({ title, onPress }: { title: string; onPress: () => void }) {
  const colors = useNtpColors();
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const fill = pressed ? colors.askFillPressed : hovered ? colors.askFillHover : colors.askFill;
  return (
    <View {...hoverProps} style={FILL}>
      <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} accessibilityRole="button" accessibilityLabel={title}>
        <View style={[ASK_PLATE, { backgroundColor: fill }]}>
          <Text size="small" weight="medium" style={{ color: colors.askText }}>
            {title}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const FILL = { flex: 1 } as const;
const LINK = { textDecorationLine: "underline" } as const;
const BADGE_PLATE = { width: BADGE, height: BADGE, borderRadius: radius.button, alignItems: "center", justifyContent: "center" } as const;
const BADGE_GLYPH = { width: BADGE, height: BADGE } as const;
const ASK_PLATE = { height: ASK_HEIGHT, borderRadius: radius.button, alignItems: "center", justifyContent: "center" } as const;
