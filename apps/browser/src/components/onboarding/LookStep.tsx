import { appIcons, currentAppIcon, setAppIcon, type AppIcon } from "../../state/app/appSettings";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { space } from "../ui/tokens";
import { PROFILE_COLORS } from "../ui/theme";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import type { Settings } from "../../state/settings/settings";
import { ChoiceList, type ChoiceOption, type MockFocus } from "./ChoiceList";
import { ThemePicker } from "../settings/ThemeEditor";
import { MockPanel, StylePanel, useScreen } from "./Screen";
import { liquidGlass, previewColor, previewLive, previewTheme, setOnboardingExtras, useOnboarding } from "../../state/onboarding/onboarding";
import { keysOf } from "../../state/onboarding/questions";
import { change, Page, useQuestion } from "./LayoutSteps";
import { OptionCard } from "./OptionCard";
import { OptionRow, useOnboardingCard } from "./Parts";
import { Slider } from "../settings/ThemeControls";
import { Text } from "../ui";
import { noteOnboardingStyle } from "../../state/telemetry/usage";
import { PAGE_FRAME, pageFrameInset } from "../../lib/windowLayout";

const LOOK_KEYS = keysOf("look");
const DETAIL_KEYS = keysOf("details");

const APPEARANCE_OPTIONS: { value: Settings["appearance"]; title: string }[] = [
  { value: "auto", title: "Automatic" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];
const SITE_COLOR_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "sitecolor-on", title: "Take on the site's color", subtitle: "The tab bar blends into the page" },
  { value: false, preview: "sitecolor-off", title: "Keep my theme color", subtitle: "The same color on every site" },
];
const STYLE_CHOICES: ChoiceOption<Settings["interfaceStyle"]>[] = [
  { value: "glass", preview: "style-glass", title: "Liquid Glass", subtitle: "Buttons and panels catch the light, as in Tahoe" },
  { value: "classic", preview: "style-classic", title: "Classic", subtitle: "Flat and quiet, as in Dia" },
];
const SWITCHER_CHOICES: ChoiceOption<boolean>[] = [
  { value: false, preview: "switcher-dots", title: "Dots", subtitle: "A quiet row of dots, as in Dia" },
  { value: true, preview: "switcher-icons", title: "Icons", subtitle: "Each profile's symbol or emoji, as in Arc" },
];
const BOOKMARKS_BAR: { value: Settings["bookmarksBar"]; title: string }[] = [
  { value: "always", title: "Always" },
  { value: "newTab", title: "New Tab" },
  { value: "never", title: "Never" },
];
const APPEARANCE_LABEL = { auto: "automatic", light: "always light", dark: "always dark" } as const;
const FRAME_CHOICES: { value: number; title: string; subtitle: string }[] = [
  { value: PAGE_FRAME.default, title: "Framed", subtitle: "Rounded corners with a little room around the page" },
  { value: 4, title: "Thin", subtitle: "A slim frame and softer corners" },
  { value: 0, title: "Edge to edge", subtitle: "No frame: the page meets the window and the sidebar" },
];
const FRAME_VALUE_WIDTH = 40;
const framePicked = (frame: number) => (frame === PAGE_FRAME.default ? [] : frame === 0 ? ["Edge-to-edge page"] : [`Page frame ${frame} pt`]);

export function LookStep() {
  const { focus } = useQuestion("look");
  const { values, mock } = useScreen(LOOK_KEYS);
  const windowId = useOnboarding((s) => s.windowId) ?? "";
  const color = useWindowProfileValue(windowId, (p) => p?.color);
  const customTheme = useWindowProfileValue(windowId, (p) => !!p?.theme);
  useEffect(() => {
    previewLive(liquidGlass ? { appearance: values.appearance, interfaceStyle: values.interfaceStyle } : { appearance: values.appearance });
  }, []);
  const name = customTheme ? "Custom" : color ? PROFILE_COLORS[color]?.name : null;
  const glass = liquidGlass ? { interfaceStyle: values.interfaceStyle, glassTintWithTheme: values.glassTintWithTheme } : {};
  const styleLine = !liquidGlass ? [] : values.interfaceStyle === "classic" ? ["Classic style"] : values.glassTintWithTheme ? ["Tinted glass"] : [];
  return (
    <Page
      id="look"
      title="Make it yours"
      subtitle="Your color, light or dark, and the style. Everything else is set up for you."
      patch={{ appearance: values.appearance, ...glass }}
      picked={[...(name ? [`${name} theme`] : []), ...(values.appearance === "auto" ? [] : [`Appearance ${APPEARANCE_LABEL[values.appearance]}`]), ...styleLine]}
      preview={liquidGlass ? <StylePanel settings={mock} focus={focus.focus} /> : <MockPanel settings={mock} focus={focus.focus} />}
      onConfirm={() => liquidGlass && noteOnboardingStyle(values.interfaceStyle, values.glassTintWithTheme)}
    >
      <ThemePicker windowId={windowId} size={32} gap={space.xs} onPreset={previewColor} onTheme={previewTheme} />
      <OptionRow title="Appearance" value={values.appearance} options={APPEARANCE_OPTIONS} onChange={(appearance) => change({ appearance }, true)} />
      {liquidGlass ? (
        <StyleChoices style={values.interfaceStyle} tint={values.glassTintWithTheme} mock={focus} />
      ) : null}
    </Page>
  );
}

function StyleChoices({ style, tint, mock }: { style: Settings["interfaceStyle"]; tint: boolean; mock: MockFocus }) {
  const { compact } = useOnboardingCard();
  return (
    <View style={{ gap: compact ? space.m : space.ml }}>
      <ChoiceList options={STYLE_CHOICES} value={style} onChange={(interfaceStyle) => change({ interfaceStyle }, true)} mock={mock} />
      {style === "glass" ? (
        <OptionCard
          control="check"
          title="Tint the glass with your color"
          subtitle={compact ? undefined : "Buttons and fields take on your theme color"}
          selected={tint}
          onPress={() => change({ glassTintWithTheme: !tint }, true)}
        />
      ) : null}
    </View>
  );
}

export function DetailsStep() {
  const { id, focus } = useQuestion("details");
  const { values, mock } = useScreen(DETAIL_KEYS);
  const appIcon = useOnboarding((s) => s.extras.appIcon);
  const [icons, setIcons] = useState<{ list: AppIcon[]; current: string | null }>({ list: [], current: null });
  const preview = <MockPanel settings={mock} focus={focus.focus} />;
  useEffect(() => {
    previewLive({ extendWebsiteColor: values.extendWebsiteColor });
    void Promise.all([appIcons(56), currentAppIcon()]).then(
      ([list, current]) => setIcons({ list, current }),
      () => {},
    );
  }, []);

  if (id === "frame") {
    const frame = pageFrameInset(values);
    return (
      <Page
        id={id}
        title="How much frame?"
        subtitle="The room between the page and the window. Change it any time in Settings › Appearance."
        patch={{ pageFrame: values.pageFrame, borderlessMode: values.borderlessMode }}
        picked={framePicked(frame)}
        preview={preview}
      >
        <View style={{ gap: space.ml }}>
          {FRAME_CHOICES.map((c) => (
            <OptionCard key={c.value} control="radio" title={c.title} subtitle={c.subtitle} selected={frame === c.value} onPress={() => change({ pageFrame: c.value, borderlessMode: false }, true)} />
          ))}
          <View style={{ marginTop: space.m }}>
            <Slider stacked label="Thickness" value={frame / PAGE_FRAME.max} onChange={(v) => change({ pageFrame: Math.round(v * PAGE_FRAME.max), borderlessMode: false }, true)}>
              <Text size="small" tone="textSecondary" style={{ width: FRAME_VALUE_WIDTH, textAlign: "right" }}>
                {`${frame} pt`}
              </Text>
            </Slider>
          </View>
        </View>
      </Page>
    );
  }
  if (id === "switcher")
    return (
      <Page
        id={id}
        title="Dots or icons?"
        subtitle="How the switcher at the bottom of the sidebar shows your profiles."
        patch={{ profileSwitcherIcons: values.profileSwitcherIcons }}
        picked={values.profileSwitcherIcons ? ["Profile icons in the sidebar"] : []}
        preview={<MockPanel settings={mock} focus={focus.focus} switcher />}
      >
        <ChoiceList
          options={SWITCHER_CHOICES}
          value={values.profileSwitcherIcons}
          onChange={(profileSwitcherIcons) => change({ profileSwitcherIcons })}
          mock={focus}
        />
      </Page>
    );
  if (id === "lookMore")
    return (
      <Page
        id={id}
        title="A few finishing touches"
        subtitle="All of these live in Settings too."
        patch={{ hideToolbarWhileScrolling: values.hideToolbarWhileScrolling, bookmarksBar: values.bookmarksBar }}
        picked={[]}
        preview={preview}
        onConfirm={() => {
          if (appIcon && appIcon !== icons.current) void setAppIcon(appIcon);
        }}
      >
        <View style={{ gap: space.m }}>
          {icons.list.length > 1 ? (
            <OptionRow
              title="App icon"
              value={appIcon ?? icons.current ?? icons.list[0]!.id}
              options={icons.list.map((i) => ({ value: i.id, title: i.name, image: i.preview }))}
              onChange={(id) => setOnboardingExtras({ appIcon: id })}
            />
          ) : null}
          <OptionCard
            control="check"
            title="Hide toolbar while scrolling"
            subtitle="Scroll up to bring it back"
            selected={values.hideToolbarWhileScrolling}
            onPress={() => change({ hideToolbarWhileScrolling: !values.hideToolbarWhileScrolling })}
          />
          <OptionRow title="Bookmarks bar" value={values.bookmarksBar} options={BOOKMARKS_BAR} onChange={(bookmarksBar) => change({ bookmarksBar })} />
        </View>
      </Page>
    );
  return (
    <Page
      id="siteColor"
      title="Let sites tint the tab bar?"
      subtitle="Many sites have a color of their own."
      patch={{ extendWebsiteColor: values.extendWebsiteColor }}
      picked={[]}
      preview={preview}
    >
      <ChoiceList options={SITE_COLOR_CHOICES} value={values.extendWebsiteColor} onChange={(extendWebsiteColor) => change({ extendWebsiteColor }, true)} mock={focus} />
    </Page>
  );
}
