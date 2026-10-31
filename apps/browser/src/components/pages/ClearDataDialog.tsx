import { clearBrowsingData, type BrowsingDataType } from "../../state/spaces/spaceData";
import { useState } from "react";
import { View } from "react-native";
import { pruneSpaceFavicons } from "../../state/favicons/favicons";
import { engineProfileForSpace, isIncognitoSpace } from "../../state/browser/model";
import { useSpaceName, useSpaceOrder } from "../../state/spaces/hooks";
import { clearHistory } from "../../state/history/actions";
import { Box, Button, Checkbox, Dialog, PopUp, space, Text } from "../ui";
import { clearDataDialog } from "./tokens";
import { useProfile, useProfileSpaces } from "../../state/profiles/hooks";
import { useSpace } from "../../state/browser/hooks";

const RANGES = [
  { value: "hour", title: "Last hour", ms: 3_600_000 },
  { value: "day", title: "Last 24 hours", ms: 86_400_000 },
  { value: "week", title: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "month", title: "Last 4 weeks", ms: 28 * 86_400_000 },
  { value: "all", title: "All time", ms: Infinity },
] as const;
type Range = (typeof RANGES)[number]["value"];

export function ClearDataDialog({ spaceId, profileId, onClose }: { spaceId?: string; profileId?: string; onClose: () => void }) {
  const workspace = useSpace(spaceId, (value) => value);
  const profile = useProfile(profileId ?? workspace?.profileId ?? "");
  const affected = useProfileSpaces(profile?.id ?? "");
  const [range, setRange] = useState<Range>("hour");
  const [history, setHistory] = useState(true);
  const [siteData, setSiteData] = useState(true);
  const [busy, setBusy] = useState(false);

  const clear = async () => {
    setBusy(true);
    const ms = RANGES.find((r) => r.value === range)!.ms;
    const since = ms === Infinity ? undefined : Date.now() - ms;
    if (history) {
      for (const id of affected) {
        clearHistory(id, since);
        pruneSpaceFavicons(id);
      }
    }
    const types: BrowsingDataType[] = [...(history ? ["history" as const] : []), ...(siteData ? ["siteData" as const, "cache" as const] : [])];
    if (types.length && profile) await clearBrowsingData(profile.engineId, types, since);
    setBusy(false);
    onClose();
  };

  return (
    <Dialog width={clearDataDialog.width} onDismiss={onClose}>
      <Text size="heading" weight="semibold">
        Clear Browsing Data
      </Text>
      {profile && (
        <Text size="small" tone="textSecondary" style={PROFILE_LINE}>
          {`From ${profile.name}, across all its spaces`}
        </Text>
      )}
      <Box row gap="ml" style={RANGE_ROW}>
        <Text>Time range</Text>
        <PopUp value={range} options={RANGES.map(({ value, title }) => ({ value, title }))} onChange={setRange} minWidth={clearDataDialog.rangeMinWidth} />
      </Box>
      <Box gap="l" style={OPTIONS}>
        <Option value={history} onChange={setHistory} title="Browsing history" subtitle="Clears the pages you visited from History and the command bar." />
        <Option
          value={siteData}
          onChange={setSiteData}
          title="Cookies, site data and cached files"
          subtitle="Signs you out of most sites."
        />
      </Box>
      <Box row gap="m" style={BUTTONS}>
        <Button title="Cancel" onPress={onClose} />
        <Button title="Clear Data" kind="primary" disabled={busy || (!history && !siteData)} onPress={() => void clear()} />
      </Box>
    </Dialog>
  );
}

const PROFILE_LINE = { marginTop: space.xs } as const;
const RANGE_ROW = { alignItems: "center", marginTop: space.xl } as const;
const OPTIONS = { marginTop: space.xl } as const;
const BUTTONS = { justifyContent: "flex-end", marginTop: clearDataDialog.buttonsTop } as const;
const OPTION_NOTE = { marginLeft: clearDataDialog.noteIndent, marginTop: space.xxs } as const;

function Option({ value, onChange, title, subtitle }: { value: boolean; onChange: (v: boolean) => void; title: string; subtitle: string }) {
  return (
    <View>
      <Checkbox value={value} onChange={onChange} label={title} />
      <Text size="footnote" tone="textSecondary" style={OPTION_NOTE}>
        {subtitle}
      </Text>
    </View>
  );
}
