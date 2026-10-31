import { appIcons, currentAppIcon, setAppIcon, type AppIcon } from "../../state/app/appSettings";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { PROFILE_COLORS } from "../ui/theme";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import type { Settings } from "../../state/settings/settings";
import { ChoiceList, type ChoiceOption } from "./ChoiceList";
import { ThemeColorPicker } from "./Personalize";
import { MockPanel, useScreen } from "./Screen";
import { previewColor, previewLive, previewTheme, setOnboardingExtras, useOnboarding } from "../../state/onboarding/onboarding";
import { keysOf } from "../../state/onboarding/questions";
import { change, Page, useQuestion } from "./LayoutSteps";
import { CheckRow, OptionRow } from "./Parts";
import { Slider } from "../settings/ThemeControls";

const LOOK_KEYS = keysOf("look");

const APPEARANCE_CHOICES: ChoiceOption<Settings["appearance"]>[] = [
  { value: "auto", preview: "appearance-auto", title: "Automatic", subtitle: "Light by day, dark by night, like your Mac" },
  { value: "light", preview: "appearance-light", title: "Light", subtitle: "Always light" },
  { value: "dark", preview: "appearance-dark", title: "Dark", subtitle: "Always dark" },
];
const SITE_COLOR_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "sitecolor-on", title: "Take on the site's color", subtitle: "The tab bar blends into the page" },
  { value: false, preview: "sitecolor-off", title: "Keep my theme color", subtitle: "The same color on every site" },
];
const STYLE_CHOICES: ChoiceOption<Settings["interfaceStyle"]>[] = [
  { value: "glass", preview: "style-glass", title: "Liquid Glass", subtitle: "Buttons and panels catch the light, as in macOS Tahoe" },
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

export function LookStep() {
  const { id, focus } = useQuestion("look");
  const { values, mock } = useScreen(LOOK_KEYS);
  const windowId = useOnboarding((s) => s.windowId) ?? "";
  const appIcon = useOnboarding((s) => s.extras.appIcon);
  const color = useWindowProfileValue(windowId, (p) => p?.color);
  const customTheme = useWindowProfileValue(windowId, (p) => !!p?.theme);
  const [icons, setIcons] = useState<{ list: AppIcon[]; current: string | null }>({ list: [], current: null });
  const preview = <MockPanel settings={mock} focus={focus.focus} />;
  useEffect(() => {
    previewLive({ appearance: values.appearance, interfaceStyle: values.interfaceStyle, extendWebsiteColor: values.extendWebsiteColor });
    void Promise.all([appIcons(56), currentAppIcon()]).then(
      ([list, current]) => setIcons({ list, current }),
      () => {},
    );
  }, []);

  if (id === "appearance")
    return (
      <Page
        id={id}
        title="Light or dark?"
        subtitle="Incognito windows are always dark."
        patch={{ appearance: values.appearance }}
        picked={[`Appearance ${APPEARANCE_LABEL[values.appearance]}`]}
        preview={preview}
      >
        <ChoiceList options={APPEARANCE_CHOICES} value={values.appearance} onChange={(appearance) => change({ appearance }, true)} mock={focus} />
      </Page>
    );
  if (id === "style")
    return (
      <Page
        id={id}
        title="Glass or classic?"
        subtitle="Change it any time in Settings › Appearance."
        patch={{ interfaceStyle: values.interfaceStyle, glassTintWithTheme: values.glassTintWithTheme, glassTintAmount: values.glassTintAmount }}
        picked={values.interfaceStyle === "classic" ? ["Classic style"] : values.glassTintWithTheme ? [`Glass tinted ${Math.round(values.glassTintAmount * 100)} %`] : []}
        preview={preview}
      >
        <ChoiceList options={STYLE_CHOICES} value={values.interfaceStyle} onChange={(interfaceStyle) => change({ interfaceStyle }, true)} mock={focus} />
        {values.interfaceStyle === "glass" ? (
          <View style={{ gap: 10, marginTop: 18 }}>
            <CheckRow
              title="Tint the glass with your color"
              subtitle="Buttons and fields take on your theme color"
              value={values.glassTintWithTheme}
              onChange={(glassTintWithTheme) => change({ glassTintWithTheme }, true)}
            />
            {values.glassTintWithTheme ? (
              <Slider stacked label="Tint amount" value={values.glassTintAmount} onChange={(v) => change({ glassTintAmount: Math.round(v * 100) / 100 }, true)} />
            ) : null}
          </View>
        ) : null}
      </Page>
    );
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
  if (id === "siteColor")
    return (
      <Page
        id={id}
        title="Let sites tint the tab bar?"
        subtitle="Many sites have a color of their own."
        patch={{ extendWebsiteColor: values.extendWebsiteColor }}
        picked={[]}
        preview={preview}
      >
        <ChoiceList
          options={SITE_COLOR_CHOICES}
          value={values.extendWebsiteColor}
          onChange={(extendWebsiteColor) => change({ extendWebsiteColor }, true)}
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
        <View style={{ gap: 8 }}>
          {icons.list.length > 1 ? (
            <OptionRow
              title="App icon"
              value={appIcon ?? icons.current ?? icons.list[0]!.id}
              options={icons.list.map((i) => ({ value: i.id, title: i.name, image: i.preview }))}
              onChange={(id) => setOnboardingExtras({ appIcon: id })}
            />
          ) : null}
          <CheckRow
            title="Hide toolbar while scrolling"
            subtitle="Scroll up to bring it back"
            value={values.hideToolbarWhileScrolling}
            onChange={(hideToolbarWhileScrolling) => change({ hideToolbarWhileScrolling })}
          />
          <OptionRow title="Bookmarks bar" value={values.bookmarksBar} options={BOOKMARKS_BAR} onChange={(bookmarksBar) => change({ bookmarksBar })} />
        </View>
      </Page>
    );
  const name = customTheme ? "Custom" : color ? PROFILE_COLORS[color]?.name : null;
  return (
    <Page id="color" title="Pick a color" subtitle="It tints the sidebar and the window." patch={{}} picked={name ? [`${name} theme`] : []} preview={preview}>
      <ThemeColorPicker windowId={windowId} size={32} gap={5} onPick={(c) => previewColor(c)} onTheme={previewTheme} />
    </Page>
  );
}
