import { fileExists, fileIcon, Symbol } from "@ardia/shell";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useHover } from "../primitives";
import { importModule } from "../import/module";
import { openImport } from "../settings/windows";
import { CONTENT_WIDTH } from "./choices";
import { presetFor, useOnboarding, type BrowserSourceId } from "./state";
import { StepActions, StepLayout } from "./steps";
import { CheckMark, SecondaryButton, SectionLabel, Tag, useOnboardingColors } from "./ui";

const ICON = require("../../../assets/app-icon.png");

type Candidate = { id: Exclude<BrowserSourceId, "fresh">; name: string; app: string; importId?: string };

const CANDIDATES: Candidate[][] = [
  [{ id: "arc", name: "Arc", app: "/Applications/Arc.app" }],
  [{ id: "dia", name: "Dia", app: "/Applications/Dia.app" }],
  [{ id: "chrome", name: "Chrome", app: "/Applications/Google Chrome.app" }],
  [
    { id: "safari", name: "Safari", app: "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app" },
    { id: "safari", name: "Safari", app: "/Applications/Safari.app" },
  ],
  [{ id: "firefox", name: "Firefox", app: "/Applications/Firefox.app" }],
  [
    { id: "brave", name: "Brave", app: "/Applications/Brave Browser.app" },
    { id: "brave", name: "Brave Beta", app: "/Applications/Brave Browser Beta.app", importId: "braveBeta" },
    { id: "brave", name: "Brave Nightly", app: "/Applications/Brave Browser Nightly.app", importId: "braveNightly" },
    { id: "edge", name: "Edge", app: "/Applications/Microsoft Edge.app" },
    { id: "edge", name: "Edge Beta", app: "/Applications/Microsoft Edge Beta.app", importId: "edgeBeta" },
  ],
];

type Tile = { id: BrowserSourceId; name: string; app: string | null; icon: string | null; importId?: string };

function detect(): Tile[] {
  return CANDIDATES.map((group) => {
    const found = group.find((c) => fileExists(c.app));
    if (found) return { id: found.id, name: found.name, app: found.app, icon: null, importId: found.importId };
    return { id: group[0]!.id, name: [...new Set(group.filter((c) => !c.importId).map((c) => c.name))].join(" or "), app: null, icon: null };
  });
}

const TILE = (CONTENT_WIDTH - 8 * 3) / 4;

export function SourceStep() {
  const colors = useOnboardingColors();
  const source = useOnboarding((s) => s.source);
  const [tiles, setTiles] = useState<Tile[]>(detect);
  const [importing, setImporting] = useState<BrowserSourceId | null>(null);

  useEffect(() => {
    void Promise.all(tiles.map(async (t) => ({ ...t, icon: t.app ? ((await fileIcon(t.app, 64)) ?? null) : null }))).then(setTiles);
  }, []);

  const found = tiles.filter((t) => t.app);
  const others = tiles.filter((t) => !t.app);
  const chosen = tiles.find((t) => t.id === source);
  const canImport = !!chosen?.app && !!importModule();
  const choose = (id: BrowserSourceId) => useOnboarding.getState().chooseSource(id);

  const startImport = () => {
    if (!chosen) return;
    openImport(chosen.importId ?? chosen.id);
    setImporting(chosen.id);
  };

  const done = () => useOnboarding.getState().confirm("source", {}, chosen ? [`Coming from ${chosen.name}`] : source === "fresh" ? ["Starting fresh"] : []);

  return (
    <StepLayout
      title="Where are you coming from?"
      subtitle="Ardia sets itself up the way you're used to. Change anything later."
      actions={
        <StepActions
          disabled={!source}
          onContinue={done}
          onSkip={() => useOnboarding.getState().skip()}
        />
      }
      preview={<SourcePreview tile={chosen ?? null} fresh={source === "fresh"} found={found} />}
    >
      {found.length ? (
        <View style={{ gap: 8 }}>
          <SectionLabel title="Found on this Mac" />
          <TileGrid tiles={found} selected={source} onPress={choose} />
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <SectionLabel title={found.length ? "Others" : "Browsers"} />
        <TileGrid tiles={others} selected={source} onPress={choose} fresh />
      </View>
      {canImport && chosen ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.row,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.rowBorder,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: colors.title }}>
              {importing === chosen.id ? `Importing from ${chosen.name}` : `Bring your stuff from ${chosen.name}`}
            </Text>
            <Text style={{ fontSize: 12, color: colors.rowSubtitle }}>
              {importing === chosen.id ? "It runs in its own window. Carry on here." : "Bookmarks, history, passwords and tabs."}
            </Text>
          </View>
          {importing === chosen.id ? <CheckMark on size={18} /> : <SecondaryButton title="Import…" filled onPress={startImport} />}
        </View>
      ) : null}
    </StepLayout>
  );
}

function TileGrid({ tiles, selected, onPress, fresh }: { tiles: Tile[]; selected: BrowserSourceId | null; onPress: (id: BrowserSourceId) => void; fresh?: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
      {tiles.map((t) => (
        <SourceTile key={t.id} title={t.name} icon={t.icon} symbol="globe" selected={selected === t.id} onPress={() => onPress(t.id)} />
      ))}
      {fresh ? <SourceTile title="Starting fresh" icon={null} symbol="sparkles" selected={selected === "fresh"} onPress={() => onPress("fresh")} /> : null}
    </View>
  );
}

function SourceTile({ title, icon, symbol, selected, onPress }: { title: string; icon: string | null; symbol: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              width: TILE,
              height: 84,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              backgroundColor: selected || hovered ? colors.button : colors.row,
              borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            {icon ? (
              <Image source={{ uri: icon }} style={{ width: 40, height: 40 }} />
            ) : (
              <View style={{ width: 34, height: 34, margin: 3, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.iconContainer }}>
                <Symbol name={symbol} size={15} color={colors.subtitle} style={{ width: 20, height: 20 }} />
              </View>
            )}
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "500", paddingHorizontal: 4, color: selected ? colors.title : colors.subtitle }}>
              {title}
            </Text>
            {selected ? (
              <View style={{ position: "absolute", top: 5, right: 5 }}>
                <CheckMark on size={14} />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function SourcePreview({ tile, fresh, found }: { tile: Tile | null; fresh: boolean; found: Tile[] }) {
  const colors = useOnboardingColors();
  const preset = presetFor(tile?.id ?? (fresh ? "fresh" : null));
  const from = tile ? [tile] : fresh ? [] : found.filter((t) => t.icon).slice(0, 6);
  return (
    <View style={{ alignItems: "center", gap: 22 }}>
      {from.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, maxWidth: 300 }}>
          {from.map((t) => (
            <View key={t.id} style={{ alignItems: "center", gap: 6, width: tile ? 96 : 72 }}>
              {t.icon ? (
                <Image source={{ uri: t.icon }} style={{ width: tile ? 88 : 56, height: tile ? 88 : 56 }} />
              ) : (
                <View style={{ width: 72, height: 72, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.iconContainer }}>
                  <Symbol name="globe" size={28} color={colors.subtitle} style={{ width: 36, height: 36 }} />
                </View>
              )}
              <Text style={{ fontSize: 11, color: colors.subtitle }}>{t.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {from.length ? <Symbol name="arrow.down" size={18} weight="medium" color={colors.steps} style={{ width: 24, height: 24 }} /> : null}
      <Image source={ICON} style={{ width: tile || fresh ? 96 : 72, height: tile || fresh ? 96 : 72 }} />
      {tile || fresh ? <Tag title={preset === "arc" ? "Starts out Arc-style" : "Starts out Dia-style"} /> : null}
    </View>
  );
}
