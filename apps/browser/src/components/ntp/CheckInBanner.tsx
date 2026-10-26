import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { CHECK_IN_COPY, useDefaultBrowserCheckIn } from "../../state/onboarding/defaultBrowserCheckIn";
import { Box, radius, space, Symbol, Text } from "../ui";
import { NtpCard, NtpCardSlot, NtpCardSurface, NtpCardTitle, useCardRetire } from "./NtpCard";
import { useNtpColors } from "./tokens";

const ICON = require("../../../assets/app-icon.png");

const FRAME = { width: 282, height: 69 };
const ICON_SIZE = 37;
const ACTION_GAP = 3;

export function CheckInBanner({ windowId }: { windowId: string }) {
  const checkIn = useDefaultBrowserCheckIn(windowId);
  const [leaving, retire] = useCardRetire();
  if (!checkIn.visible && !leaving) return null;
  return (
    <NtpCardSlot width={FRAME.width} height={FRAME.height}>
      <Card leaving={leaving} onFeedback={() => retire(checkIn.leaveFeedback)} onClose={() => retire(checkIn.dismiss)} />
    </NtpCardSlot>
  );
}

function Card({ leaving, onFeedback, onClose }: { leaving: null | (() => void); onFeedback: () => void; onClose: () => void }) {
  const colors = useNtpColors();
  const [pressed, setPressed] = useState(false);
  return (
    <NtpCard appearDelay={300} leaving={leaving} onClose={onClose} lift pressed={pressed} style={FILL}>
      <Pressable
        onPress={onFeedback}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${CHECK_IN_COPY.title} ${CHECK_IN_COPY.action}`}
        style={FILL}
      >
        <NtpCardSurface />
        <Box row padX="ml" gap="ml" style={ROW}>
          <View style={ICON_FRAME}>
            <Image source={ICON} style={ICON_IMAGE} />
          </View>
          <Box gap="xxs" style={TEXT_COLUMN}>
            <NtpCardTitle>{CHECK_IN_COPY.title}</NtpCardTitle>
            <View style={ACTION_ROW}>
              <Text size="small" style={{ color: colors.body }}>
                {CHECK_IN_COPY.action}
              </Text>
              <Symbol name="arrow.up.right" size={9} weight="medium" color={colors.arrow} style={ARROW} />
            </View>
          </Box>
        </Box>
      </Pressable>
    </NtpCard>
  );
}

const FILL = { flex: 1 } as const;
const ROW = { flex: 1, alignItems: "center" } as const;
const ICON_FRAME = { width: ICON_SIZE, height: ICON_SIZE, borderRadius: radius.m, overflow: "hidden", alignItems: "center", justifyContent: "center" } as const;
const ICON_IMAGE = { width: ICON_SIZE, height: ICON_SIZE } as const;
const TEXT_COLUMN = { flex: 1, paddingLeft: space.xs } as const;
const ACTION_ROW = { flexDirection: "row", alignItems: "center", gap: ACTION_GAP } as const;
const ARROW = { width: 11, height: 11 } as const;
