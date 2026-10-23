import { Symbol } from "@ardia/shell";
import { View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import {
  LITTLE_DESTINATION,
  newLinkRuleId,
  RECENT_DESTINATION,
  withDefaultDestination,
  withLinkRule,
  withLinkRuleChanged,
  withoutLinkRule,
  type LinkDestination,
  type LinkRouting,
  type LinkRule,
} from "../../../store/linkRouting";
import { lastActiveProfile } from "../../../store/small";
import { IconButton } from "../../primitives";
import { Button, Group, PopUp, Row, SectionHeader, TextField, type Option } from "../controls";

const MATCH_OPTIONS: Option<LinkRule["match"]>[] = [
  { value: "contains", title: "Contains" },
  { value: "equals", title: "Is equal to" },
];

const destinationValue = (d: LinkDestination) => (d.kind === "profile" ? `profile:${d.profileId}` : d.kind);

const destinationFrom = (value: string): LinkDestination =>
  value === "little" ? LITTLE_DESTINATION : value === "recent" ? RECENT_DESTINATION : { kind: "profile", profileId: value.slice("profile:".length) };

const routing = () => useBrowser.getState().settings.linkRouting;
const save = (linkRouting: LinkRouting) => useBrowser.getState().updateSettings({ linkRouting });

export function useLinkDestinationOptions(): Option<string>[] {
  const profiles = useBrowser((s) => s.profiles);
  const order = useBrowser((s) => s.profileOrder);
  return [
    ...order.filter((id) => profiles[id]).map((id) => ({ value: `profile:${id}`, title: profiles[id]!.name })),
    { value: "recent", title: "Most Recent Profile", separatorBefore: true },
    { value: "little", title: "Little Ardia" },
  ];
}

export function LinkDefaultPopUp({ minWidth = 190 }: { minWidth?: number }) {
  const value = useBrowser((s) => destinationValue(s.settings.linkRouting.defaultDestination));
  const options = useLinkDestinationOptions();
  return <PopUp value={value} options={options} onChange={(v) => save(withDefaultDestination(routing(), destinationFrom(v)))} minWidth={minWidth} />;
}

export function LinksPane() {
  const rules = useBrowser((s) => s.settings.linkRouting.rules);
  const options = useLinkDestinationOptions();
  const add = () => {
    const s = useBrowser.getState();
    save(withLinkRule(s.settings.linkRouting, { id: newLinkRuleId(), match: "contains", text: "", destination: { kind: "profile", profileId: lastActiveProfile(s) } }));
  };

  return (
    <View>
      <SectionHeader
        anchor="links.routes"
        description="A link that matches a route opens there instead. The first matching route wins."
        action={<Button title="New Route" icon="plus" onPress={add} />}
      />
      <Group>
        {rules.length === 0 ? (
          <Row title="No routes" description="Add one to open matching links in a profile or in Little Ardia." />
        ) : (
          rules.map((rule) => <RouteRow key={rule.id} rule={rule} options={options} />)
        )}
      </Group>

      <SectionHeader title="Links from other apps" description="Where a link from another app opens when no route matches it." />
      <Group>
        <Row anchor="links.otherApps">
          <LinkDefaultPopUp />
        </Row>
      </Group>
    </View>
  );
}

function RouteRow({ rule, options }: { rule: LinkRule; options: Option<string>[] }) {
  const theme = useTheme();
  const change = (patch: Partial<Omit<LinkRule, "id">>) => save(withLinkRuleChanged(routing(), rule.id, patch));
  return (
    <View style={{ minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <PopUp value={rule.match} options={MATCH_OPTIONS} onChange={(match) => change({ match })} minWidth={106} />
      <TextField value={rule.text} onChangeText={(text) => change({ text })} placeholder="example.com" style={{ flex: 1 }} />
      <Symbol name="arrow.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 14, height: 14 }} />
      <PopUp value={destinationValue(rule.destination)} options={options} onChange={(v) => change({ destination: destinationFrom(v) })} minWidth={150} />
      <IconButton icon="trash" size={12} box={24} radius={6} onPress={() => save(withoutLinkRule(routing(), rule.id))} tooltip="Remove Route" />
    </View>
  );
}
