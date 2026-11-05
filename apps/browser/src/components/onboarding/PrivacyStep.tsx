import { engineHost } from "@ardia/core";
import { StyleSheet, View } from "react-native";
import { searchEngines, type Settings } from "../../state/settings/settings";
import { useSettings } from "../../state/browser/hooks";
import { isSharing, setSharing } from "../../state/telemetry/client";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { Text } from "../ui";
import { radius, space, tracking } from "../ui/tokens";
import { SiteLogo } from "./SiteLogo";
import { ChoiceList, useMockFocus, type ChoiceOption } from "./ChoiceList";
import { Page } from "./LayoutSteps";
import { MockPanel, useScreen } from "./Screen";
import { setOnboardingDraft, setOnboardingExtras, useOnboarding } from "../../state/onboarding/onboarding";
import { keysOf, useQuestions } from "../../state/onboarding/questions";
import { OptionCard } from "./OptionCard";
import { SelectTile, useOnboardingColors } from "./Parts";
import { useSiteRing } from "./GlassBacking";
import { MONO, onboardingType, receiptStamp } from "./tokens";

const KEYS = keysOf("searchPrivacy");
const ENGINES = ["google", "duckduckgo", "bing", "kagi", "ecosia", "brave", "startpage"];

const TYPED_CHOICES: ChoiceOption<Settings["commandBarPreference"]>[] = [
  { value: "website", preview: "typed-website", title: "Go to the website", subtitle: "“github” opens github.com" },
  { value: "search", preview: "typed-search", title: "Search for it", subtitle: "“github” searches the web" },
];

export function SearchPrivacyStep() {
  const sub = useOnboarding((s) => s.sub);
  const id = useQuestions("searchPrivacy")[sub]?.id;
  const focus = useMockFocus(id);
  const { values, mock } = useScreen(KEYS);
  const setDraft = setOnboardingDraft;
  const share = useOnboarding((s) => s.extras.share) ?? isSharing();
  const all = useSettings((st) => searchEngines(st));
  const engines = all.filter((e) => ENGINES.includes(e.id) || e.id === values.searchEngine);

  if (id === "typed")
    return (
      <Page
        id={id}
        title="Type a word. What happens?"
        subtitle="When what you type could be a site."
        patch={{ commandBarPreference: values.commandBarPreference }}
        picked={[]}
        preview={<MockPanel settings={mock} focus={focus.focus} />}
      >
        <ChoiceList
          options={TYPED_CHOICES}
          value={values.commandBarPreference}
          onChange={(commandBarPreference) => setDraft({ commandBarPreference })}
          mock={focus}
        />
      </Page>
    );
  if (id === "crash")
    return (
      <Page
        id={id}
        title={SHARING_COPY.onboarding.title}
        subtitle={SHARING_COPY.onboarding.subtitle}
        patch={{}}
        picked={share ? ["Sharing crash reports"] : []}
        onConfirm={() => setSharing(share, "onboarding")}
        preview={<MockPanel settings={mock} focus={null} overlay={<Receipt on={share} />} />}
      >
        <OptionCard control="check" icon="stethoscope" title={SHARING_COPY.toggle} subtitle={SHARING_COPY.onboarding.row} selected={share} onPress={() => setOnboardingExtras({ share: !share })} />
      </Page>
    );
  const engine = all.find((e) => e.id === values.searchEngine);
  return (
    <Page
      id="engine"
      title="Search with what?"
      subtitle="For anything that isn't a website."
      patch={{ searchEngine: values.searchEngine }}
      picked={[`Search with ${engine?.name ?? "your engine"}`]}
      preview={<MockPanel settings={mock} focus={focus.focus} />}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }} accessibilityRole="radiogroup" accessibilityLabel="Search engine">
        {engines.map((e) => (
          <EngineTile key={e.id} title={e.name} url={`https://${engineHost(e)}`} selected={e.id === values.searchEngine} onPress={() => setDraft({ searchEngine: e.id })} />
        ))}
      </View>
    </Page>
  );
}

function EngineTile({ title, url, selected, onPress }: { title: string; url: string; selected: boolean; onPress: () => void }) {
  const ring = useSiteRing(url, selected);
  return (
    <SelectTile title={title} height={64} selected={selected} role="radio" titleLines={1} ring={ring} onPress={onPress}>
      {() => <SiteLogo url={url} size={18} />}
    </SelectTile>
  );
}

const SENT = ["Crash reports", "Error types", "Feature counts", "Speed and memory"];
const ALWAYS = ["Daily open count"];
const NEVER = ["Sites you visit", "What you type", "Your tabs", "Your name"];

const RECEIPT_WIDTH = 250;

function Receipt({ on }: { on: boolean }) {
  const colors = useOnboardingColors();
  const mono = { fontFamily: MONO } as const;
  const line = (label: string, mark: string, dim: boolean) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: space.s, opacity: dim ? 0.35 : 1 }}>
      <Text size="caption" color={colors.title} style={mono}>
        {label}
      </Text>
      <Text size="caption" lines={1} ellipsizeMode="clip" color={colors.steps} style={[mono, { flex: 1 }]}>
        {".".repeat(40)}
      </Text>
      <Text size="caption" color={colors.title} style={mono}>
        {mark}
      </Text>
    </View>
  );
  const rule = <View style={{ height: 1, borderBottomWidth: 1, borderStyle: "dashed", borderColor: colors.rowBorder, marginVertical: space.ml }} />;
  return (
    <View
      style={{
        width: RECEIPT_WIDTH,
        paddingHorizontal: space.xl,
        paddingVertical: space.xl,
        borderRadius: radius.control,
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "2deg" }],
      }}
    >
      <Text size="caption" weight="bold" color={colors.title} style={[mono, { letterSpacing: tracking.wide, textAlign: "center" }]}>
        ARDIA
      </Text>
      <Text color={colors.subtitle} style={[mono, onboardingType.receiptSmall, { textAlign: "center", marginTop: space.xs }]}>
        ITEMIZED. UNLIKE SOME EXPENSES.
      </Text>
      {rule}
      <View style={{ gap: space.s }}>
        {SENT.map((label) => line(label, on ? "SENT" : "—", !on))}
        {ALWAYS.map((label) => line(label, "SENT", false))}
      </View>
      {rule}
      <View style={{ gap: space.s }}>{NEVER.map((label) => line(label, "NEVER", false))}</View>
      {rule}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text size="caption" weight="bold" color={colors.title} style={mono}>
          PERSONAL DATA
        </Text>
        <Text size="caption" weight="bold" color={colors.title} style={mono}>
          0.00
        </Text>
      </View>
      <View
        style={{
          alignSelf: "center",
          marginTop: space.xl,
          paddingHorizontal: space.m,
          paddingVertical: space.xs,
          borderWidth: 1.5,
          borderRadius: radius.hair,
          borderColor: on ? receiptStamp : colors.steps,
          transform: [{ rotate: "-6deg" }],
        }}
      >
        <Text color={on ? receiptStamp : colors.steps} style={[mono, onboardingType.receiptStamp]}>
          {on ? "THANK YOU" : "NOT SHARED"}
        </Text>
      </View>
    </View>
  );
}
