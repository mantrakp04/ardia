import { fileExists, fileIcon } from "../../state/app/system";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { Symbol } from "../ui";
import { font, weight } from "../ui/tokens";
import { importModule } from "../../state/import/importApi";
import { isWebDemo } from "../../state/onboarding/demoSteps";
import { openImport } from "../../state/settings/settingsWindows";
import { CONTENT_WIDTH } from "./ChoiceList";
import { chooseSource, confirmAnswer, PRESET_NAMES, presetFor, presetPatch, skipStep, useOnboarding, type BrowserSourceId } from "../../state/onboarding/onboarding";
import { StepActions, StepLayout } from "./StepLayout";
import { SecondaryButton } from "./Buttons";
import { CheckMark, SectionLabel, SelectTile, Tag, useOnboardingColors } from "./Parts";
import { SetupCodeLink, SetupCodeStep } from "./SetupCodeStep";
import { browserIcon } from "./browserIcons";
import { GlassBacking, solidFill, useImageRing } from "./GlassBacking";

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
    { id: "zen", name: "Zen", app: "/Applications/Zen.app" },
    { id: "zen", name: "Zen", app: "/Applications/Zen Browser.app" },
    { id: "zen", name: "Zen Twilight", app: "/Applications/Zen Twilight.app" },
  ],
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
    const names = [...new Set(group.filter((c) => !c.importId).map((c) => c.name))];
    const families = names.filter((name) => !names.some((other) => other !== name && name.startsWith(`${other} `)));
    return { id: group[0]!.id, name: families.join(" or "), app: null, icon: null };
  });
}

const TILE = (CONTENT_WIDTH - 8 * 3) / 4;

export function SourceStep() {
  const colors = useOnboardingColors();
  const source = useOnboarding((s) => s.source);
  const [tiles, setTiles] = useState<Tile[]>(detect);
  const [importing, setImporting] = useState<BrowserSourceId | null>(null);
  const [pastingCode, setPastingCode] = useState(false);

  useEffect(() => {
    void Promise.all(tiles.map(async (t) => ({ ...t, icon: t.app ? ((await fileIcon(t.app, 64)) ?? null) : null }))).then(setTiles);
  }, []);

  const found = tiles.filter((t) => t.app);
  const others = tiles.filter((t) => !t.app);
  const chosen = tiles.find((t) => t.id === source);
  const canImport = !isWebDemo && !!chosen?.app && !!importModule();
  const choose = (id: BrowserSourceId) => chooseSource(id);

  const startImport = () => {
    if (!chosen) return;
    openImport(chosen.importId ?? chosen.id);
    setImporting(chosen.id);
  };

  const done = () => confirmAnswer("source", presetPatch(source), chosen ? [`Coming from ${chosen.name}`] : source === "fresh" ? ["Starting fresh"] : []);

  if (pastingCode) return <SetupCodeStep onBack={() => setPastingCode(false)} />;

  return (
    <StepLayout
      title="Where are you coming from?"
      subtitle="Ardia sets itself up the way you're used to."
      actions={
        <>
          <StepActions
            disabled={!source}
            onContinue={done}
            onSkip={() => skipStep()}
          />
          {isWebDemo ? null : <SetupCodeLink onPress={() => setPastingCode(true)} />}
        </>
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
            backgroundColor: solidFill(colors.row),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.rowBorder,
          }}
        >
          <GlassBacking fill={colors.row} radius={12} border={StyleSheet.hairlineWidth * 2} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...font.body, fontWeight: weight.medium, color: colors.title }}>
              {importing === chosen.id ? `Importing from ${chosen.name}` : `Bring your stuff from ${chosen.name}`}
            </Text>
            <Text style={{ ...font.small, color: colors.rowSubtitle }}>
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
        <SourceTile key={t.id} title={t.name} icon={browserIcon(t.id, t.icon)} symbol="globe" selected={selected === t.id} onPress={() => onPress(t.id)} />
      ))}
      {fresh ? <SourceTile title="Starting fresh" icon={null} symbol="sparkles" selected={selected === "fresh"} onPress={() => onPress("fresh")} /> : null}
    </View>
  );
}

function SourceTile({ title, icon, symbol, selected, onPress }: { title: string; icon: ImageSourcePropType | null; symbol: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const ring = useImageRing(icon, selected);
  return (
    <SelectTile title={title} width={TILE} height={68} gap={5} checkSize={13} selected={selected} role="radio" titlePad={4} titleLines={1} ring={ring} onPress={onPress}>
      {() =>
        icon ? (
          <Image source={icon} style={{ width: 30, height: 30 }} />
        ) : (
          <View style={{ width: 26, height: 26, margin: 2, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: colors.iconContainer }}>
            <Symbol name={symbol} size={15} color={colors.subtitle} style={{ width: 20, height: 20 }} />
          </View>
        )
      }
    </SelectTile>
  );
}

function SourcePreview({ tile, fresh, found }: { tile: Tile | null; fresh: boolean; found: Tile[] }) {
  const colors = useOnboardingColors();
  const preset = presetFor(tile?.id ?? (fresh ? "fresh" : null));
  const from = tile ? [tile] : fresh ? [] : found.filter((t) => t.app).slice(0, 6);
  return (
    <View style={{ alignItems: "center", gap: 22 }}>
      {from.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, maxWidth: 300 }}>
          {from.map((t) => ({ t, icon: browserIcon(t.id, t.icon) })).map(({ t, icon }) => (
            <View key={t.id} style={{ alignItems: "center", gap: 6, width: tile ? 96 : 72 }}>
              {icon ? (
                <Image source={icon} style={{ width: tile ? 88 : 56, height: tile ? 88 : 56 }} />
              ) : (
                <View style={{ width: 72, height: 72, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.iconContainer }}>
                  <Symbol name="globe" size={28} color={colors.subtitle} style={{ width: 36, height: 36 }} />
                </View>
              )}
              <Text style={{ ...font.caption, color: colors.subtitle }}>{t.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {from.length ? <Symbol name="arrow.down" size={18} weight="medium" color={colors.steps} style={{ width: 24, height: 24 }} /> : null}
      <Image source={ICON} style={{ width: tile || fresh ? 96 : 72, height: tile || fresh ? 96 : 72 }} />
      {tile || fresh ? <Tag title={`Starts out ${PRESET_NAMES[preset]}-style`} /> : null}
    </View>
  );
}
