import { memo, useEffect, useState } from "react";
import { Animated, View } from "react-native";
import { everySlowly } from "../../state/app/slowTimers";
import { Button, hairline, radius, space, Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useSettings, useWindow } from "../../state/browser/hooks";
import { cleanUpTabs } from "../../state/pins/actions";
import { DAILY_CLEAN_UP_MINUTES } from "../../state/settings/cleanUpAfter";
import { updateSettings } from "../../state/settings/actions";
import { cleanUpCandidateCount } from "../../state/sidebar/current";
import { useShownTabId } from "../../state/sidebar/hooks";
import { useShift } from "./EntryMotion";
import { useSidebarTokens } from "./tokens";

const UPSELL_MIN = 10;
const FILL = { flex: 1 } as const;
let upsellDeclined = false;

export const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useSettings((st) => st.cleanUpInactiveTabsAfterMinutes !== null);
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
  const button = (title: string, onPress: () => void, primary = false) => <Button variant="pill" tone="chip" size="m" primary={primary} title={title} onPress={onPress} />;
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View {...moved} ref={movedRef} style={[{ marginTop: space.ml, borderRadius: radius.panel, padding: space.ml, backgroundColor: tokens.groupFill, borderWidth: hairline.panel, borderColor: tokens.groupStroke, gap: space.m }, moved.style as object]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text size="small" weight="semibold" style={FILL}>
          {count} tabs haven’t been touched in a while
        </Text>
      </View>
      <Text size="small" tone="textSecondary">
        Ardia can tidy up for you. You can always reopen closed tabs from the ⌄ menu.
      </Text>
      <View style={{ gap: space.s }}>
        {button("Clean Up Once", () => {
          cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          updateSettings({ cleanUpInactiveTabsAfterMinutes: DAILY_CLEAN_UP_MINUTES });
          cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
});
