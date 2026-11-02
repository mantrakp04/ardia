import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useWindowHistory } from "../../state/history/hooks";
import { confirmAnswer, setOnboardingExtras, skipStep, useOnboarding } from "../../state/onboarding/onboarding";
import { PINNABLE_SITES, pinnedHosts, pinSites, preselectedSites } from "../../state/onboarding/sites";
import { SiteLogo } from "./SiteLogo";
import { useSiteRing } from "./GlassBacking";
import { ChoiceCard } from "./ChoiceCard";
import { Dot } from "../ui";
import { capsule, radius, space } from "../ui/tokens";
import { SelectTile, useOnboardingColors } from "./Parts";
import { StepActions, StepLayout } from "./StepLayout";
import { trafficLights } from "./tokens";

export function PinnedTabsStep() {
  const windowId = useOnboarding((s) => s.windowId);
  const chosen = useOnboarding((s) => s.extras.pins);
  const history = useWindowHistory(windowId);
  const suggested = useRef<string[] | null>(null);
  if (!chosen) suggested.current = preselectedSites(history ?? [], windowId ? pinnedHosts(windowId) : undefined);
  const selected = chosen ?? suggested.current ?? [];

  const toggle = (id: string) =>
    setOnboardingExtras({ pins: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });

  const pinSelected = () => {
    if (windowId && selected.length) pinSites(windowId, selected);
    confirmAnswer("pins", {}, selected.length ? [`${selected.length} ${selected.length === 1 ? "app" : "apps"} pinned`] : []);
  };

  return (
    <StepLayout
      title="Keep your favorite apps handy"
      subtitle="Pin the apps you use most. They stay put when you open Ardia."
      actions={
        <StepActions
          continueTitle={selected.length ? `Pin ${selected.length} ${selected.length === 1 ? "Tab" : "Tabs"}` : "Continue"}
          onContinue={pinSelected}
          onSkip={() => skipStep()}
        />
      }
      preview={<PinnedPreview selected={selected} />}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
        {PINNABLE_SITES.map((site) => (
          <SiteTile key={site.id} title={site.title} url={site.url} selected={selected.includes(site.id)} onPress={() => toggle(site.id)} />
        ))}
      </View>
    </StepLayout>
  );
}

function SiteTile({ title, url, selected, onPress }: { title: string; url: string; selected: boolean; onPress: () => void }) {
  const ring = useSiteRing(url, selected);
  return (
    <SelectTile title={title} width={80} height={70} selected={selected} role="checkbox" ring={ring} onPress={onPress}>
      {(hovered) => (
        <View style={{ opacity: selected || hovered ? 1 : 0.7 }}>
          <SiteLogo url={url} size={22} />
        </View>
      )}
    </SelectTile>
  );
}

const PREVIEW = { width: 236, scale: 0.75, tile: { width: 64, height: 40 }, row: 22, rowIcon: 12, rowBar: 6 } as const;
const LIGHT = 12;

function PinnedPreview({ selected }: { selected: string[] }) {
  const colors = useOnboardingColors();
  const sites = PINNABLE_SITES.filter((s) => selected.includes(s.id));
  const slots = Math.max(6, Math.ceil(sites.length / 3) * 3);
  return (
    <ChoiceCard plain radius={radius.sheet} style={{ width: PREVIEW.width, padding: space.xl, gap: space.l }}>
      <View style={{ flexDirection: "row", gap: space.m * PREVIEW.scale }}>
        {trafficLights.map((c) => (
          <Dot key={c} size={LIGHT * PREVIEW.scale} color={c} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {Array.from({ length: slots }, (_, i) => {
          const site = sites[i];
          const tile = { ...PREVIEW.tile, alignItems: "center", justifyContent: "center" } as const;
          return site ? (
            <ChoiceCard key={site.id} radius={radius.chrome * PREVIEW.scale} fill={colors.button} border={null} style={tile}>
              <SiteLogo url={site.url} size={18} />
            </ChoiceCard>
          ) : (
            <ChoiceCard key={`empty-${i}`} dashed radius={radius.chrome * PREVIEW.scale} fill="transparent" style={tile} />
          );
        })}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      {[0.7, 0.5, 0.6].map((w, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: space.m, height: PREVIEW.row }}>
          <View style={{ width: PREVIEW.rowIcon, height: PREVIEW.rowIcon, borderRadius: radius.hair, backgroundColor: colors.progressTrack }} />
          <View style={{ height: PREVIEW.rowBar, borderRadius: capsule(PREVIEW.rowBar), width: `${w * 100}%`, backgroundColor: colors.progressTrack }} />
        </View>
      ))}
    </ChoiceCard>
  );
}
