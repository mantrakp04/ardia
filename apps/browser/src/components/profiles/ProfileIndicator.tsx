import { Pressable, View } from "react-native";
import { profileNameColor, useTheme } from "../ui/theme";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../../state/browser/hooks";
import { setMeasuredWidth, useMeasuredWidth } from "../../state/windows/measuredWidths";
import { radius, Symbol, Text, useHover } from "../ui";
import { openProfileMenu } from "../../state/browser/actions";

const PAD = 9;
const HEIGHT = 34;
const MIN_CUT_NAME = 52;
const ICON_WIDTH = 32;
export const PROFILE_INDICATOR_X = 84;

function useIndicator(room: number) {
  const theme = useTheme();
  const incognito = useIsIncognito();
  const profiles = useProfiles();
  const profile = useWindowProfile();
  const title = incognito ? "Incognito" : profile.name;
  const textWidth = useMeasuredWidth(`profile-name|${title}`);
  const shown = (incognito || profiles.length >= 2) && room >= ICON_WIDTH;
  const nameRoom = room - 2 * PAD;
  const showName = !!textWidth && (textWidth <= nameRoom || nameRoom >= MIN_CUT_NAME);
  const width = !shown ? 0 : showName ? Math.min(room, textWidth + 2 * PAD) : ICON_WIDTH;
  const color = incognito ? theme.textPrimary : profileNameColor(profile, theme.dark);
  return { incognito, title, textWidth, shown, showName, width, color };
}

export const useProfileIndicatorWidth = (room: number) => useIndicator(room).width;

export function ProfileIndicator({ room }: { room: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  const { incognito, title, textWidth, shown, showName, width, color } = useIndicator(room);
  if (!shown) return null;

  return (
    <View {...hoverProps} tooltip={incognito ? undefined : "Switch between profiles"} style={{ marginTop: 0.5 }}>
      <View pointerEvents="none" style={{ position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text
          numberOfLines={1}
          weight="semibold"
          style={{ alignSelf: "flex-start" }}
          onLayout={(e) => setMeasuredWidth(`profile-name|${title}`, Math.ceil(e.nativeEvent.layout.width))}
        >
          {title}
        </Text>
      </View>
      <Pressable onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT,
              width,
              borderRadius: radius.card,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: showName ? PAD : 0,
              backgroundColor: incognito ? undefined : pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
            }}
          >
            {showName ? (
              <Text numberOfLines={1} ellipsizeMode="tail" weight="semibold" style={{ flexShrink: 1, color }}>
                {title}
              </Text>
            ) : textWidth ? (
              <Symbol name="person.fill" size={14} weight="semibold" color={color} style={{ width: 16, height: 16 }} />
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}
