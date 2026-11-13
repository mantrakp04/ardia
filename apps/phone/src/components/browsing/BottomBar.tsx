import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "../../state/browse/hooks";
import { editPageAddress, goBack, goForward, reload, stopLoading } from "../../state/browse/store";
import { display } from "../../state/search/omnibox";
import { barCenterFromBottom, barHeight, browseLayout, capsule, font, PressScale, rolesFor, space, Symbol, type ColorRoles, type SymbolName } from "../ui";

export function BottomBar({ fill, dark }: { fill: string; dark: boolean }) {
  const insets = useSafeAreaInsets();
  const roles = rolesFor(dark);
  const canGoBack = useNavigation((n) => n?.canGoBack ?? false);
  const canGoForward = useNavigation((n) => n?.canGoForward ?? false);
  const isLoading = useNavigation((n) => n?.isLoading ?? false);
  const url = useNavigation((n) => n?.url ?? null);
  const host = url ? display(url).host || display(url).display : "";
  return (
    <View style={[styles.bar, { height: barHeight(insets.bottom), backgroundColor: fill }]}>
      <View style={[styles.controls, { bottom: barCenterFromBottom(insets.bottom) - browseLayout.hitTarget / 2 }]}>
        <BarButton icon="chevronLeft" label="Back" disabled={!canGoBack} roles={roles} onPress={() => void goBack()} />
        <BarButton icon="chevronRight" label="Forward" disabled={!canGoForward} roles={roles} onPress={() => void goForward()} />
        <PressScale
          label={host ? `Address, ${host}` : "Address"}
          onPress={editPageAddress}
          grow
          style={[styles.host, { backgroundColor: roles.plusFill, borderColor: roles.controlEdge }]}
        >
          <Text style={[font.subheadline, { color: roles.foregroundPrimary }]} numberOfLines={1}>
            {host}
          </Text>
        </PressScale>
        <BarButton
          icon={isLoading ? "xmark" : "arrowClockwise"}
          label={isLoading ? "Stop" : "Reload"}
          roles={roles}
          onPress={() => void (isLoading ? stopLoading() : reload())}
        />
      </View>
    </View>
  );
}

type BarButtonProps = { icon: SymbolName; label: string; disabled?: boolean; roles: ColorRoles; onPress: () => void };

function BarButton({ icon, label, disabled, roles, onPress }: BarButtonProps) {
  return (
    <PressScale label={label} disabled={disabled} onPress={onPress} style={styles.button}>
      <Symbol name={icon} size={19} color={disabled ? roles.disabled : roles.foregroundPrimary} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0 },
  controls: {
    position: "absolute",
    left: browseLayout.barSideInset - space.xs,
    right: browseLayout.barSideInset - space.xs,
    height: browseLayout.hitTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  button: { width: browseLayout.hitTarget, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center" },
  host: {
    flex: 1,
    height: browseLayout.hostPillHeight,
    borderRadius: capsule(browseLayout.hostPillHeight),
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.l,
  },
});
