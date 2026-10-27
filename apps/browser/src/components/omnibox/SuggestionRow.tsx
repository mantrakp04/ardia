import { displayUrl, type Suggestion } from "@ardia/core";
import { memo } from "react";
import { Image, Pressable, Text as NativeText, View } from "react-native";
import { Button, Symbol, Text, useHover, useTheme } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { SUGGESTION, SUGGESTION_ROWS, type SuggestionRowMetrics, type SuggestionVariant } from "./tokens";

const ICON_BOX = { width: SUGGESTION.iconBox, height: SUGGESTION.iconBox } as const;

export function SuggestionIcon({ suggestion: s, color }: { suggestion: Suggestion; color?: string }) {
  const theme = useTheme();
  const tint = color ?? theme.textSecondary;
  switch (s.kind) {
    case "page":
      return <Favicon url={s.url} favicon={s.favicon} />;
    case "create":
      return <Favicon url={`https://${s.site}`} />;
    case "search":
      return <Symbol name="magnifyingglass" size={SUGGESTION.icon} color={tint} style={ICON_BOX} />;
    case "calc":
      return <Symbol name="equal.circle" size={SUGGESTION.calcIcon} color={tint} style={ICON_BOX} />;
    case "action":
      return <Symbol name={s.icon ?? "command"} size={SUGGESTION.icon} color={tint} style={ICON_BOX} />;
    case "extension":
      return s.icon ? (
        <Image source={{ uri: s.icon }} style={ICON_BOX} />
      ) : (
        <Symbol name="puzzlepiece.extension" size={SUGGESTION.icon} color={tint} style={ICON_BOX} />
      );
  }
}

function labels(s: Suggestion): [string, string | null] {
  switch (s.kind) {
    case "page":
      if (s.tabId) return [s.title || displayUrl(s.url), "Switch to Tab"];
      return s.title ? [s.title, displayUrl(s.url)] : [displayUrl(s.url), null];
    case "search":
      return [s.bang ? `Search ${s.engine} for ${s.query}` : s.query, null];
    case "calc":
      return [s.value, s.expression];
    case "action":
    case "create":
      return [s.title, null];
    case "extension":
      return [s.title, s.open === "action" ? "Open Extension" : "Extension Options"];
  }
}

export type RowActions = {
  choose(s: Suggestion): void;
  remove(url: string): void;
};

export const SuggestionList = memo(function SuggestionList({
  items,
  selectedIndex,
  trailing,
  variant,
  actions,
}: {
  items: Suggestion[];
  selectedIndex: number;
  trailing: string | null;
  variant: SuggestionVariant;
  actions: RowActions;
}) {
  if (!items.length) return null;
  const metrics = SUGGESTION_ROWS[variant];
  return (
    <View style={{ paddingHorizontal: metrics.inset, paddingBottom: metrics.below }}>
      {items.map((s, i) => (
        <SuggestionRow
          key={i}
          suggestion={s}
          selected={i === selectedIndex}
          trailing={i === 0 ? trailing : null}
          metrics={metrics}
          actions={actions}
        />
      ))}
    </View>
  );
});

function sameSuggestion(a: Suggestion, b: Suggestion): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof Suggestion)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export const isRemovable = (s: Suggestion | undefined): s is Extract<Suggestion, { kind: "page" }> => s?.kind === "page" && !!s.visited && !s.tabId;

const SuggestionRow = memo(
  function SuggestionRow({
    suggestion: s,
    selected,
    trailing,
    metrics,
    actions,
  }: {
    suggestion: Suggestion;
    selected: boolean;
    trailing: string | null;
    metrics: SuggestionRowMetrics;
    actions: RowActions;
  }) {
    const theme = useTheme();
    const { hovered, hoverProps } = useHover();
    const [title, accessory] = labels(s);
    const hint = trailing ?? (s.kind === "action" ? s.hint : null);
    const onRemove = isRemovable(s) ? () => actions.remove(s.url) : undefined;
    const removable = !!onRemove && (hovered || selected);
    return (
      <View {...hoverProps}>
        <Pressable onPress={() => actions.choose(s)}>
          <View
            style={{
              height: metrics.height,
              marginVertical: metrics.gapY,
              borderRadius: metrics.radius,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: metrics.left,
              paddingRight: metrics.right,
              gap: metrics.gap,
              backgroundColor: selected ? theme.commandBarSelected : hovered ? theme.commandBarHover : undefined,
            }}
          >
            <SuggestionIcon suggestion={s} />
            <Text lines={1} size="title" style={{ flexShrink: 1 }}>
              {title}
              {accessory ? (
                <NativeText style={{ color: theme.textSecondary }}>
                  {" — "}
                  {accessory}
                </NativeText>
              ) : null}
            </Text>
            <View style={{ flex: 1 }} />
            {hint && !removable ? <Text size="small" tone="textTertiary">{hint}</Text> : null}
            {removable ? (
              <Button variant="icon" icon="xmark" size={SUGGESTION.remove.glyph} box={SUGGESTION.remove.box} radius={SUGGESTION.remove.radius} color={theme.textSecondary} tooltip="Remove from History" onPress={onRemove} />
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  },
  (a, b) => a.selected === b.selected && a.trailing === b.trailing && a.metrics === b.metrics && a.actions === b.actions && sameSuggestion(a.suggestion, b.suggestion),
);
