import type { ReactNode } from "react";
import { Image, Pressable, Text as NativeText, View } from "react-native";
import { plural } from "../../state/browser/model";
import { Box, Checkbox, ink, Radio, Symbol, Text, useHover, useTheme } from "../ui";
import type { BrowserSource, SpaceSummary } from "./model";
import { accentAlpha, importColors, importLayout, importType } from "./tokens";

function browserDetail(browser: BrowserSource) {
  const spaces = browser.profiles.reduce((n, p) => n + (p.spaces?.length ?? 0), 0);
  return browser.needsFullDiskAccess
    ? "Needs Full Disk Access"
    : browser.requiresExport
      ? "Direct or from an exported .zip"
      : browser.sidebar && spaces
        ? plural(spaces, "space")
        : browser.profiles.length > 1
          ? plural(browser.profiles.length, "profile")
          : "";
}

export function BrowserRow({ browser, selected, onPress }: { browser: BrowserSource; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const detail = browserDetail(browser);
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <Box
          row
          center
          padX="l"
          gap="l"
          radius="card"
          fill={hovered ? "rowHover" : "groupFill"}
          border="groupBorder"
          style={{
            height: importLayout.browserRow,
            ...(selected ? { backgroundColor: `${theme.formAccent}${accentAlpha.selected}`, borderWidth: importLayout.selectedBorder, borderColor: theme.formAccent } : null),
          }}
        >
          <Radio on={selected} look="form" />
          {browser.iconPath ? (
            <Image source={{ uri: `file://${browser.iconPath}` }} style={{ width: 32, height: 32 }} />
          ) : (
            <Symbol name="globe" size={22} color={theme.icon} style={{ width: 32, height: 32 }} />
          )}
          <Text size="title" weight="medium" style={{ flex: 1 }}>
            {browser.name}
          </Text>
          {detail ? (
            <Text size="small" tone="textSecondary">
              {detail}
            </Text>
          ) : null}
          {browser.needsKeychain && <Symbol name="lock" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />}
        </Box>
      </Pressable>
    </View>
  );
}

export function SelectRow({ selected, onToggle, icon, title, subtitle }: { selected: boolean; onToggle: (v: boolean) => void; icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <Pressable onPress={() => onToggle(!selected)}>
      <Box row center padX="l" gap="l" radius="card" fill="groupFill" border="groupBorder" style={{ minHeight: importLayout.selectRow }}>
        <Checkbox value={selected} onChange={onToggle} />
        {icon}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: importType.rowTitle }}>{title}</Text>
          {subtitle ? (
            <Text size="footnote" tone="textSecondary" style={{ marginTop: 1 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Box>
    </Pressable>
  );
}

export function Monogram({ name, color }: { name: string; color?: string }) {
  const size = importLayout.avatar;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? importColors.monogramFallback, alignItems: "center", justifyContent: "center" }}>
      <Text weight="semibold" style={{ color: ink.white }}>
        {(name.trim()[0] ?? "?").toUpperCase()}
      </Text>
    </View>
  );
}

export function SpaceIcon({ space: summary }: { space: SpaceSummary }) {
  const size = importLayout.avatar;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: importLayout.spaceIconRadius,
        backgroundColor: summary.color ?? importColors.monogramFallback,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {summary.emoji ? (
        <NativeText style={{ fontSize: importType.emoji }}>{summary.emoji}</NativeText>
      ) : (
        <Symbol name="square.stack" size={12} color={ink.white} style={{ width: 16, height: 16 }} />
      )}
    </View>
  );
}

export function ProfileAvatar({ path, name, color }: { path?: string; name: string; color?: string }) {
  const size = importLayout.avatar;
  return path ? <Image source={{ uri: `file://${path}` }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : <Monogram name={name} color={color} />;
}
