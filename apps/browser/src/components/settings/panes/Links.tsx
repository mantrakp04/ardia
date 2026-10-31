import { View } from "react-native";
import { Button, ContextMenuArea, Group, PopUp, Symbol, Text, TextField, useTheme, type Option } from "../../ui";
import { showMenu } from "../../../state/app/system";
import { updateSettings } from "../../../state/settings/actions";
import { decodeDestination, encodeDestination, useDestinationOptions, useLinkRouting, useRecentProfileId, withCurrentDestination } from "../../../state/linkRouting/hooks";
import { newLinkRouteId, withDefaultDestination, withoutRoute, withRoute, withRouteChanged, withRouteMoved, type LinkRoute, type RouteMatch } from "../../../lib/linkRouting";
import { Row, SectionHeader } from "../Form";

const APP = "Ardia";

const MATCH_OPTIONS: Option<RouteMatch>[] = [
  { value: "contains", title: "Contains" },
  { value: "equals", title: "Is equal to" },
];

export function OtherAppsDestinationPopUp({ minWidth = 190 }: { minWidth?: number }) {
  const routing = useLinkRouting();
  const options = withCurrentDestination(useDestinationOptions(), routing.defaultDestination);
  return (
    <PopUp
      value={encodeDestination(routing.defaultDestination)}
      options={options}
      onChange={(v) => updateSettings({ linkRouting: withDefaultDestination(routing, decodeDestination(v)) })}
      minWidth={minWidth}
      accessibilityLabel="Open links from other apps in"
    />
  );
}

export function LinksPane() {
  const routing = useLinkRouting();
  const options = useDestinationOptions();
  const recentProfileId = useRecentProfileId();
  const addRoute = () =>
    updateSettings({ linkRouting: withRoute(routing, { id: newLinkRouteId(), match: "contains", pattern: "", destination: { kind: "profile", profileId: recentProfileId } }) });
  return (
    <View>
      <SectionHeader anchor="links.routes" title="Air Traffic Control" action={<Button title="New Route" icon="plus" onPress={addRoute} />} />
      <Group>
        {routing.routes.length === 0 ? (
          <EmptyRoutes />
        ) : (
          routing.routes.map((route, i) => (
            <RouteRow key={route.id} route={route} options={withCurrentDestination(options, route.destination)} position={i + 1} last={i === routing.routes.length - 1} />
          ))
        )}
      </Group>

      <SectionHeader anchor="links.otherApps" />
      <Group>
        <Row anchor="links.otherApps">
          <OtherAppsDestinationPopUp />
        </Row>
      </Group>
    </View>
  );
}

function EmptyRoutes() {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 28, paddingHorizontal: 32, gap: 12 }}>
      <Symbol name="airplane" size={34} weight="light" color={theme.textTertiary} style={{ width: 48, height: 48 }} />
      <Text size="small" tone="textSecondary" style={{ textAlign: "center", maxWidth: 360 }}>
        {`Routes choose where specific sites open inside ${APP}. For example, route Spotify links to always open in your Personal profile, or GitHub links into a tab group.`}
      </Text>
    </View>
  );
}

function RouteRow({ route, options, position, last }: { route: LinkRoute; options: Option<string>[]; position: number; last: boolean }) {
  const theme = useTheme();
  const routing = useLinkRouting();
  const name = `route ${position}`;
  const save = (next: typeof routing) => updateSettings({ linkRouting: next });
  const change = (patch: Partial<Omit<LinkRoute, "id">>) => save(withRouteChanged(routing, route.id, patch));
  const remove = () => save(withoutRoute(routing, route.id));
  const menu = async () => {
    const choice = await showMenu([
      { id: "up", title: "Move Up", enabled: position > 1 },
      { id: "down", title: "Move Down", enabled: !last },
      { separator: true },
      { id: "remove", title: "Remove Route" },
    ]);
    if (choice === "up") save(withRouteMoved(routing, route.id, -1));
    else if (choice === "down") save(withRouteMoved(routing, route.id, 1));
    else if (choice === "remove") remove();
  };
  return (
    <ContextMenuArea onContextMenu={() => void menu()}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Symbol name="link" size={11} weight="medium" color={theme.textTertiary} style={{ width: 14, height: 14 }} />
          <Text size="small" tone="textSecondary" style={{ width: 52 }}>
            URL
          </Text>
          <PopUp value={route.match} options={MATCH_OPTIONS} onChange={(match) => change({ match })} minWidth={112} accessibilityLabel={`URL match of ${name}`} />
          <TextField value={route.pattern} onChangeText={(pattern) => change({ pattern })} placeholder="spotify.com" style={{ flex: 1 }} accessibilityLabel={`URL pattern of ${name}`} />
          <Button variant="icon" icon="minus.circle" size={13} box={22} radius={6} color={theme.textTertiary} onPress={remove} tooltip={`Remove ${name}`} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6 }}>
          <Symbol name="arrow.turn.down.right" size={11} weight="medium" color={theme.textTertiary} style={{ width: 14, height: 14 }} />
          <Text size="small" tone="textSecondary" style={{ width: 46 }}>
            Open in
          </Text>
          <PopUp value={encodeDestination(route.destination)} options={options} onChange={(v) => change({ destination: decodeDestination(v) })} minWidth={240} accessibilityLabel={`Open ${name} in`} />
        </View>
      </View>
    </ContextMenuArea>
  );
}
