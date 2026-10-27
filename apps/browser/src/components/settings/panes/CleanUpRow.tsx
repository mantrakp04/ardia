import { useEffect, useState } from "react";
import { View } from "react-native";
import { updateSettings } from "../../../state/settings/actions";
import { Button, Checkbox, PopUp, Text, TextField } from "../../ui";
import { Row } from "../Form";

const CLEAN_UP = [
  { value: "12", title: "12 hours" },
  { value: "custom", title: "Custom…" },
  { value: "24", title: "24 hours" },
  { value: "168", title: "7 days" },
  { value: "720", title: "30 days" },
];

const UNITS = [
  { value: "minutes", title: "Minutes" },
  { value: "hours", title: "Hours" },
  { value: "days", title: "Days" },
] as const;

type Unit = (typeof UNITS)[number]["value"];
const HOURS_PER_UNIT: Record<Unit, number> = { minutes: 1 / 60, hours: 1, days: 24 };

function durationParts(hours: number): { amount: string; unit: Unit } {
  if (Number.isInteger(hours / 24)) return { amount: String(hours / 24), unit: "days" };
  if (Number.isInteger(hours)) return { amount: String(hours), unit: "hours" };
  return { amount: String(Math.round(hours * 60)), unit: "minutes" };
}

function durationHours(amount: string, unit: Unit): number | null {
  if (!/^\d+$/.test(amount.trim())) return null;
  const value = Number(amount);
  const hours = value * HOURS_PER_UNIT[unit];
  return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(Math.round(hours * 3_600_000)) ? hours : null;
}

export function CleanUpRow({ hours }: { hours: number | null }) {
  const [showCustom, setShowCustom] = useState(false);
  const custom = showCustom || (hours !== null && !CLEAN_UP.some((o) => o.value === String(hours)));
  const choose = (value: string) => {
    setShowCustom(value === "custom");
    if (value !== "custom") updateSettings({ cleanUpInactiveTabsAfterHours: Number(value) });
  };
  const toggle = (on: boolean) => {
    setShowCustom(false);
    updateSettings({ cleanUpInactiveTabsAfterHours: on ? 24 : null });
  };
  return (
    <Row
      anchor="tabs.cleanUp"
      description={null}
      title={<Checkbox value={hours !== null} onChange={toggle} label="Clean up tabs I haven't used in:" />}
    >
      <View style={{ alignItems: "flex-end", gap: 8, width: 190 }}>
        <PopUp value={custom && hours !== null ? "custom" : String(hours ?? 24)} options={CLEAN_UP} disabled={hours === null} onChange={choose} minWidth={190} />
        {custom && hours !== null && <CustomCleanUp hours={hours} />}
      </View>
    </Row>
  );
}

function CustomCleanUp({ hours }: { hours: number }) {
  const [draft, setDraft] = useState(() => durationParts(hours));
  useEffect(() => {
    setDraft((current) => (durationHours(current.amount, current.unit) === hours ? current : durationParts(hours)));
  }, [hours]);
  const value = durationHours(draft.amount, draft.unit);
  const canApply = value !== null && value !== hours;
  const commit = () => {
    if (canApply) updateSettings({ cleanUpInactiveTabsAfterHours: value });
  };
  const changeUnit = (unit: Unit) => {
    setDraft((current) => ({ ...current, unit }));
  };
  return (
    <View style={{ gap: 6, width: 190 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextField value={draft.amount} onChangeText={(amount) => setDraft((current) => ({ ...current, amount }))} onSubmit={commit} selectOnFocus style={{ width: 72 }} />
        <PopUp value={draft.unit} options={[...UNITS]} onChange={changeUnit} minWidth={110} />
      </View>
      {value === null && <Text size="footnote" tone="destructive">Enter a whole number greater than zero.</Text>}
      <View style={{ alignItems: "flex-end" }}>
        <Button title="Apply" disabled={!canApply} onPress={commit} />
      </View>
    </View>
  );
}
