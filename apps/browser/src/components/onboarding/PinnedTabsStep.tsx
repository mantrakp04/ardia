import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useWindowHistory } from "../../state/history/hooks";
import { confirmAnswer, setOnboardingExtras, skipStep, useOnboarding } from "../../state/onboarding/onboarding";
import { PINNABLE_SITES, pinnedHosts, pinSites, preselectedSites } from "../../state/onboarding/sites";
import { SiteLogo } from "./SiteLogo";
import { GlassBacking, solidFill, useSiteRing } from "./GlassBacking";
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
    <SelectTile title={title} width={80} height={70} gap={7} checkSize={14} selected={selected} role="checkbox" ring={ring} onPress={onPress}>
      {(hovered) => (
        <View style={{ opacity: selected || hovered ? 1 : 0.7 }}>
          <SiteLogo url={url} size={22} />
        </View>
      )}
    </SelectTile>
  );
}

function PinnedPreview({ selected }: { selected: string[] }) {
  const colors = useOnboardingColors();
  const sites = PINNABLE_SITES.filter((s) => selected.includes(s.id));
  const slots = Math.max(6, Math.ceil(sites.length / 3) * 3);
  return (
    <View style={{ width: 236, padding: 14, borderRadius: 14, backgroundColor: colors.row, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rowBorder, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {trafficLights.map((c) => (
          <View key={c} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: c }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Array.from({ length: slots }, (_, i) => {
          const site = sites[i];
          return (
            <View
              key={site?.id ?? `empty-${i}`}
              style={{
                width: 64,
                height: 40,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: site ? solidFill(colors.button) : "transparent",
                borderWidth: site ? 0 : 1,
                borderStyle: "dashed",
                borderColor: colors.rowBorder,
              }}
            >
              {site ? <GlassBacking fill={colors.button} radius={9} /> : null}
              {site ? <SiteLogo url={site.url} size={18} /> : null}
            </View>
          );
        })}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      {[0.7, 0.5, 0.6].map((w, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 22 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors.progressTrack }} />
          <View style={{ height: 6, borderRadius: 3, width: `${w * 100}%`, backgroundColor: colors.progressTrack }} />
        </View>
      ))}
    </View>
  );
}
