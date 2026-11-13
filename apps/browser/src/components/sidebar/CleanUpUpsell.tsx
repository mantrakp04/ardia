import { memo, useEffect, useState } from "react";
import { Animated, View } from "react-native";
import { everySlowly } from "../../state/app/slowTimers";
import { Button, hairline, radius, space, Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useSettings, useWindow } from "../../state/browser/hooks";
import { DAILY_CLEAN_UP_MINUTES } from "../../state/settings/cleanUpAfter";
import { updateSettings } from "../../state/settings/actions";
import { cleanUpWithUndo } from "../../state/sidebar/clearTabs";
import { cleanUpCandidateCount } from "../../state/sidebar/current";
import { useShownTabId } from "../../state/sidebar/hooks";
import { noteCleanUp } from "../../state/telemetry/usage";
import { useShift } from "./EntryMotion";
import { useSidebarTokens } from "./tokens";

const UPSELL_MIN = 10;
const FILL = { flex: 1 } as const;
const HEADER = { flexDirection: "row", alignItems: "center", gap: space.s } as const;
const ACTIONS = { gap: space.s } as const;
const NEVER_AGAIN = { alignSelf: "center", marginTop: -space.xxs } as const;
const CLOSE_NUDGE = { marginVertical: -space.xs, marginRight: -space.xs } as const;
let declinedThisSession = false;

export const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(declinedThisSession);
  const daily = useSettings((st) => st.cleanUpInactiveTabsAfterMinutes !== null);
  const wanted = useSettings((st) => st.suggestCleanUp);
  const tabIds = useWindow(windowId, (w) => w?.tabIds);
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const activeId = useShownTabId(windowId);
  const off = hidden || daily || !wanted;
  useEffect(() => {
    if (off) return;
    const check = () => setCount(cleanUpCandidateCount(windowId));
    check();
    return everySlowly({ every: 60_000, run: check });
  }, [windowId, off, tabIds, profileId, activeId]);
  const showing = !off && count >= UPSELL_MIN;
  useEffect(() => {
    if (showing) noteCleanUp("suggestionShown");
  }, [showing]);
  if (!showing) return null;
  const hideForSession = () => {
    declinedThisSession = true;
    setHidden(true);
  };
  return (
    <SuggestionCard
      count={count}
      shift={shift}
      cleanUp={() => {
        noteCleanUp("suggestionOnce");
        cleanUpWithUndo(windowId);
        hideForSession();
      }}
      everyDay={() => {
        noteCleanUp("suggestionDaily");
        updateSettings({ cleanUpInactiveTabsAfterMinutes: DAILY_CLEAN_UP_MINUTES });
        cleanUpWithUndo(windowId);
      }}
      notNow={() => {
        noteCleanUp("suggestionNotNow");
        hideForSession();
      }}
      neverAgain={() => {
        noteCleanUp("suggestionNeverAgain");
        updateSettings({ suggestCleanUp: false });
      }}
    />
  );
});

type SuggestionCardProps = {
  count: number;
  shift: Animated.Value | null;
  cleanUp: () => void;
  everyDay: () => void;
  notNow: () => void;
  neverAgain: () => void;
};

function SuggestionCard({ count, shift, cleanUp, everyDay, notNow, neverAgain }: SuggestionCardProps) {
  const theme = useTheme();
  const [moved, movedRef] = useShift(shift);
  const tokens = useSidebarTokens();
  const card = { marginTop: space.ml, borderRadius: radius.panel, padding: space.ml, backgroundColor: tokens.groupFill, borderWidth: hairline.panel, borderColor: tokens.groupStroke, gap: space.s };
  return (
    <View {...moved} ref={movedRef} style={[card, moved.style as object]}>
      <View style={HEADER}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text size="small" weight="semibold" style={FILL}>
          {count} unused tabs
        </Text>
        <Button variant="close" look="panel" tooltip="Not Now" onPress={notNow} style={CLOSE_NUDGE} />
      </View>
      <Text size="small" tone="textSecondary">
        Auto Clean Up clears any tab unused for a day.
      </Text>
      <View style={ACTIONS}>
        <Button variant="pill" tone="chip" size="m" primary title="Clean Up Now" onPress={cleanUp} />
        <Button variant="pill" tone="chip" size="m" title="Auto Clean Up" onPress={everyDay} />
      </View>
      <View style={NEVER_AGAIN}>
        <Button variant="text" look="panel" tone="textTertiary" hoverTone="textSecondary" title="Don’t show again" onPress={neverAgain} />
      </View>
    </View>
  );
}
