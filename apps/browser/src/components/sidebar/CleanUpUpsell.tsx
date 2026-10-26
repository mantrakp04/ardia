import { memo, useEffect, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { everySlowly } from "../../state/app/slowTimers";
import { font, radius, Symbol, weight } from "../ui";
import { useTheme } from "../ui/theme";
import { useSettings, useWindow } from "../../state/browser/hooks";
import { cleanUpTabs } from "../../state/pins/actions";
import { updateSettings } from "../../state/settings/actions";
import { cleanUpCandidateCount } from "../../state/sidebar/current";
import { useShownTabId } from "../../state/sidebar/hooks";
import { useShift } from "./EntryMotion";
import { useSidebarTokens } from "./tokens";

const UPSELL_MIN = 10;
let upsellDeclined = false;

export const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useSettings((st) => st.cleanUpInactiveTabsAfterHours !== null);
  const tabIds = useWindow(windowId, (w) => w?.tabIds);
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const activeId = useShownTabId(windowId);
  const off = hidden || daily;
  useEffect(() => {
    if (off) return;
    const check = () => setCount(cleanUpCandidateCount(windowId));
    check();
    return everySlowly({ every: 60_000, run: check });
  }, [windowId, off, tabIds, profileId, activeId]);
  const [moved, movedRef] = useShift(shift);
  if (off || count < UPSELL_MIN) return null;
  const button = (title: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            height: 24,
            borderRadius: radius.button,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.upsellButtonHover : primary ? theme.textPrimary : tokens.upsellButton,
          }}
        >
          <Text style={{ ...font.small, fontWeight: weight.medium, color: primary ? theme.onPrimary : theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View {...moved} ref={movedRef} style={[{ marginTop: 10, borderRadius: radius.panel, padding: 10, backgroundColor: tokens.groupFill, borderWidth: 0.5, borderColor: tokens.groupStroke, gap: 8 }, moved.style as object]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text style={{ flex: 1, ...font.small, fontWeight: weight.semibold, color: theme.textPrimary }}>{count} tabs haven’t been touched in a while</Text>
      </View>
      <Text style={{ ...font.small, color: theme.textSecondary }}>Ardia can tidy up for you. You can always reopen closed tabs from the ⌄ menu.</Text>
      <View style={{ gap: 6 }}>
        {button("Clean Up Once", () => {
          cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          updateSettings({ cleanUpInactiveTabsAfterHours: 24 });
          cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
});
