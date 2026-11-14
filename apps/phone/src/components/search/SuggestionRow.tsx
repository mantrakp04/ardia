import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { queryPrefixLength, type TrayRow } from "../../state/search/omnibox";
import { browseLayout, font, radius, space, Symbol, type ColorRoles, type SymbolName } from "../ui";

const LEADING: Record<TrayRow["kind"], SymbolName> = { query: "magnifyingglass", page: "globe", calc: "equalCircleFill" };

type Props = { row: TrayRow; typed: string; roles: ColorRoles; onActivate: (row: TrayRow) => void; onRefine: (row: TrayRow) => void; onMenu: (row: TrayRow, y: number) => void };

export const SuggestionRow = memo(function SuggestionRow({ row, typed, roles, onActivate, onRefine, onMenu }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onActivate(row)}
      onLongPress={(event) => onMenu(row, event.nativeEvent.pageY)}
      accessibilityActions={[{ name: "longpress", label: "More Actions" }]}
      onAccessibilityAction={() => onMenu(row, 0)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? roles.rowHighlight : undefined }]}
    >
      <View style={styles.leading}>
        <Symbol name={LEADING[row.kind]} size={19} color={roles.rowIcon} />
      </View>
      <View style={styles.label}>
        {row.kind === "query" ? (
          <QueryTitle title={row.title} typed={typed} roles={roles} />
        ) : (
          <>
            <Text style={[font.body, { color: roles.foregroundPrimary }]} numberOfLines={1}>
              {row.title}
            </Text>
            <View style={styles.detail}>
              {row.kind === "page" && row.switchesTab ? <Symbol name="arrowRight" size={13} color={roles.foregroundSecondary} /> : null}
              <Text style={[font.subheadline, styles.detailText, { color: roles.foregroundSecondary }]} numberOfLines={1}>
                {row.detail}
              </Text>
            </View>
          </>
        )}
      </View>
      {row.kind === "query" ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Refine ${row.title}`} onPress={() => onRefine(row)} style={styles.refine}>
          <View style={styles.refineGlyph}>
            <Symbol name="arrowUpForward" size={15} color={roles.rowIcon} />
          </View>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

function QueryTitle({ title, typed, roles }: { title: string; typed: string; roles: ColorRoles }) {
  const prefix = queryPrefixLength(title, typed);
  return (
    <Text style={[font.title3, { color: roles.foregroundPrimary }]} numberOfLines={2}>
      {prefix > 0 ? <Text style={{ color: roles.foregroundSecondary }}>{title.slice(0, prefix)}</Text> : null}
      {title.slice(prefix)}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: browseLayout.suggestionPitch,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingLeft: browseLayout.rowLeading,
    paddingRight: browseLayout.rowTrailing,
    borderRadius: radius.row,
  },
  leading: { width: browseLayout.suggestionIconSlot, height: browseLayout.suggestionIconSlot, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, gap: space.hair },
  detail: { flexDirection: "row", alignItems: "center", gap: space.xs },
  detailText: { flexShrink: 1 },
  refine: { width: browseLayout.refineWidth, height: browseLayout.suggestionPitch, alignItems: "center", justifyContent: "center" },
  refineGlyph: { transform: [{ rotate: "-90deg" }] },
});
