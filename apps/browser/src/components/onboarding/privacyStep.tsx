import { engineHost } from "@ardia/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { searchEngines, type Settings } from "../../store/settings";
import { useBrowser } from "../../store/browser";
import { setSharing, useTelemetry } from "../../telemetry/client";
import { SHARING_COPY } from "../../telemetry/copy";
import { Favicon, useHover } from "../primitives";
import { CONTENT_WIDTH, ChoiceList, useMockFocus, type ChoiceOption } from "./choices";
import { Page } from "./layoutSteps";
import { MockPanel, useScreen } from "./screen";
import { questionsFor, useOnboarding } from "./state";
import { CheckMark, CheckRow, useOnboardingColors } from "./ui";

const KEYS = ["searchEngine", "commandBarPreference"] as const;
const ENGINES = ["google", "duckduckgo", "bing", "kagi", "ecosia", "brave", "startpage"];

const TYPED_CHOICES: ChoiceOption<Settings["commandBarPreference"]>[] = [
  { value: "website", preview: "typed-website", title: "Go to the website", subtitle: "“github” opens github.com" },
  { value: "search", preview: "typed-search", title: "Search for it", subtitle: "“github” searches the web" },
];

export function SearchPrivacyStep() {
  const sub = useOnboarding((s) => s.sub);
  const id = questionsFor("searchPrivacy")[sub]?.id;
  const focus = useMockFocus(id);
  const { values, mock } = useScreen(KEYS);
  const setDraft = useOnboarding((s) => s.setDraft);
  const share = useOnboarding((s) => s.extras.share) ?? useTelemetry.getState().sharing;
  const all = useBrowser((s) => searchEngines(s.settings));
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
        <CheckRow icon="stethoscope" title={SHARING_COPY.toggle} subtitle={SHARING_COPY.onboarding.row} value={share} onChange={(v) => useOnboarding.getState().setExtras({ share: v })} />
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Search engine">
        {engines.map((e) => (
          <EngineTile key={e.id} title={e.name} url={`https://${engineHost(e)}`} selected={e.id === values.searchEngine} onPress={() => setDraft({ searchEngine: e.id })} />
        ))}
      </View>
    </Page>
  );
}

const TILE = (CONTENT_WIDTH - 8 * 3) / 4;

function EngineTile({ title, url, selected, onPress }: { title: string; url: string; selected: boolean; onPress: () => void }) {
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
              height: 64,
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
            <Favicon url={url} size={18} />
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "500", color: selected ? colors.title : colors.subtitle }}>
              {title}
            </Text>
            {selected ? (
              <View style={{ position: "absolute", top: 5, right: 5 }}>
                <CheckMark on size={12} />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const SENT = ["Crash reports", "Error types", "Feature counts", "Speed and memory"];
const ALWAYS = ["Daily open count"];
const NEVER = ["Sites you visit", "What you type", "Your tabs", "Your name"];
const MONO = "Menlo";

function Receipt({ on }: { on: boolean }) {
  const colors = useOnboardingColors();
  const line = (label: string, mark: string, dim: boolean) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: dim ? 0.35 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.title }}>{label}</Text>
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: colors.steps }}>
        {".".repeat(40)}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.title }}>{mark}</Text>
    </View>
  );
  const rule = <View style={{ height: 1, borderBottomWidth: 1, borderStyle: "dashed", borderColor: colors.rowBorder, marginVertical: 10 }} />;
  return (
    <View
      style={{
        width: 250,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "2deg" }],
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", letterSpacing: 1, textAlign: "center", color: colors.title }}>
        ARDIA
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.6, textAlign: "center", marginTop: 3, color: colors.subtitle }}>
        ITEMIZED. UNLIKE SOME EXPENSES.
      </Text>
      {rule}
      <View style={{ gap: 6 }}>
        {SENT.map((label) => line(label, on ? "SENT" : "—", !on))}
        {ALWAYS.map((label) => line(label, "SENT", false))}
      </View>
      {rule}
      <View style={{ gap: 6 }}>{NEVER.map((label) => line(label, "NEVER", false))}</View>
      {rule}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", color: colors.title }}>PERSONAL DATA</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "700", color: colors.title }}>0.00</Text>
      </View>
      <View
        style={{
          alignSelf: "center",
          marginTop: 14,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderWidth: 1.5,
          borderRadius: 3,
          borderColor: on ? "#2F9E5B" : colors.steps,
          transform: [{ rotate: "-6deg" }],
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1, color: on ? "#2F9E5B" : colors.steps }}>
          {on ? "THANK YOU" : "NOT SHARED"}
        </Text>
      </View>
    </View>
  );
}
