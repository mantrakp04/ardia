import type { AppIcon } from "../../../state/app/appSettings";
import { Box, GlassFill, liquidGlass, PopUp, radius, space, Toggle } from "../../ui";
import { Image, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings, useTabLayout } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import type { Settings } from "../../../state/settings/settings";
import { Group, Row, SectionHeader } from "../Form";
import { MiniWindow } from "../MiniWindow";
import { PictureChoice } from "../PictureChoice";
import { AmountSlider } from "../ThemeControls";
import { BookmarksBarSection } from "./BookmarksBarSection";
import { modePreview, stylePreview } from "../tokens";
import { useSettingsColors } from "../useSettingsColors";
import { APP_ICON_SIZE, appIconChoices, chooseAppIcon } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";

const MODES: { value: Settings["appearance"]; title: string; description: string }[] = [
  { value: "auto", title: "Automatic", description: "Follow the system appearance setting" },
  { value: "light", title: "Light", description: "Use the light application appearance" },
  { value: "dark", title: "Dark", description: "Use the dark application appearance" },
];

export function AppearancePane() {
  const appearance = useSettings((s) => s.appearance);
  const spacesFollow = useSettings((s) => s.spacesFollowAppearance);
  const choose = (mode: Settings["appearance"]) => updateSettings({ appearance: mode });
  return (
    <View>
      <SectionHeader anchor="appearance.theme" />
      <Box gap="xl">
        <Box row gap="xl">
          {MODES.map((m) => (
            <ModeChoice key={m.value} mode={m.value} title={m.title} description={m.description} selected={appearance === m.value} onPress={() => choose(m.value)} />
          ))}
        </Box>
        <Group>
          <Row anchor="appearance.spacesFollowAppearance">
            <Toggle value={spacesFollow} onChange={(v) => updateSettings({ spacesFollowAppearance: v })} />
          </Row>
        </Group>
      </Box>
      <InterfaceStylePicker />
      <AddressBarPicker />
      <BookmarksBarSection />
      <SelectedTabGlowPicker />
      <ScrollBarsPicker />
      <AppIconPicker />
    </View>
  );
}

const TINT_SLIDER_WIDTH = 160;

const STYLES: { value: Settings["interfaceStyle"]; title: string }[] = [
  { value: "glass", title: "Glass" },
  { value: "classic", title: "Classic" },
];

function InterfaceStylePicker() {
  const style = useSettings((s) => s.interfaceStyle);
  const tinted = useSettings((s) => s.glassTintWithTheme);
  const tintAmount = useSettings((s) => s.glassTintAmount);
  if (!liquidGlass) return null;
  return (
    <>
      <SectionHeader anchor="appearance.interfaceStyle" />
      <Box gap="xl">
        <Box row gap="xl">
          {STYLES.map((s) => (
            <StyleChoice key={s.value} value={s.value} title={s.title} selected={style === s.value} onPress={() => updateSettings({ interfaceStyle: s.value })} />
          ))}
        </Box>
        <Group>
        <Row anchor="appearance.glassTintWithTheme">
          <Toggle value={tinted} onChange={(v) => updateSettings({ glassTintWithTheme: v })} />
        </Row>
        {tinted ? (
          <Row anchor="appearance.glassTintAmount">
            <View style={{ width: TINT_SLIDER_WIDTH }}>
              <AmountSlider value={tintAmount} tooltip={`${Math.round(tintAmount * 100)} %`} onChange={(v) => updateSettings({ glassTintAmount: Math.round(v * 100) / 100 })} />
            </View>
          </Row>
        ) : null}
        </Group>
      </Box>
    </>
  );
}

function StyleChoice({ value, title, selected, onPress }: { value: Settings["interfaceStyle"]; title: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const look = stylePreview[theme.dark ? "dark" : "light"];
  const glass = value === "glass";
  return (
    <PictureChoice title={title} selected={selected} onPress={onPress} size="m">
      <MiniWindow layout="none" look={{ window: look.backdrop, bar: look.tile, page: look.tile }}>
        <Box row gap="m" pad="xs" style={STYLE_TILES}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[STYLE_TILE, glass ? null : { backgroundColor: look.tile, borderWidth: 1, borderColor: look.tileStroke }]}>
              {glass ? <GlassFill radius={radius.tile} state={i === 0 ? "active" : "rest"} /> : null}
            </View>
          ))}
        </Box>
      </MiniWindow>
    </PictureChoice>
  );
}

const STYLE_TILES = { flex: 1 } as const;
const STYLE_TILE = { flex: 1, alignSelf: "flex-start", height: 30, borderRadius: radius.tile } as const;

function AddressBarPicker() {
  const addressBar = useSettings((s) => s.addressBar);
  const placement = useSettings((s) => s.commandBarPlacement);
  const compactToolbar = useSettings((s) => s.compactToolbar);
  const topTabs = useTabLayout() === "top";
  const choose = (value: Settings["addressBar"]) => updateSettings({ addressBar: value });
  return (
    <>
      <SectionHeader
        anchor="appearance.addressBar"
        description={
          topTabs
            ? "Tabs are across the top of the window, so the address bar stays in the toolbar. Also in View › Show Address Bar in Sidebar."
            : "In the sidebar, the page gets the toolbar’s height. While the sidebar is hidden, the address bar is in the toolbar. Also in View › Show Address Bar in Sidebar."
        }
      />
      <Box gap="xl">
        <Box row gap="xl">
          <AddressBarChoice value="toolbar" title="In the toolbar" selected={addressBar !== "sidebar"} onPress={() => choose("toolbar")} />
          <AddressBarChoice value="sidebar" title="In the sidebar" selected={addressBar === "sidebar"} onPress={() => choose("sidebar")} />
        </Box>
        <Group>
        <Row anchor="appearance.commandBarPlacement">
          <PopUp
            value={placement}
            options={[
              { value: "field", title: "At the address" },
              { value: "centred", title: "In the centre" },
            ]}
            onChange={(v) => updateSettings({ commandBarPlacement: v })}
            minWidth={160}
          />
        </Row>
        <Row anchor="appearance.compactToolbar">
          <Toggle value={compactToolbar} onChange={(v) => updateSettings({ compactToolbar: v })} />
        </Row>
        </Group>
      </Box>
    </>
  );
}

function SelectedTabGlowPicker() {
  const glow = useSettings((s) => s.selectedTabGlow);
  return (
    <>
      <SectionHeader title="Selected Tab" />
      <Group>
        <Row anchor="appearance.selectedTabGlow">
          <PopUp
            value={glow}
            options={[
              { value: "full", title: "Full" },
              { value: "soft", title: "Soft" },
              { value: "off", title: "Off" },
            ]}
            onChange={(v) => updateSettings({ selectedTabGlow: v })}
            minWidth={120}
          />
        </Row>
      </Group>
    </>
  );
}

function ScrollBarsPicker() {
  const scrollBars = useSettings((s) => s.pageScrollBars);
  return (
    <>
      <SectionHeader title="Scroll Bars" />
      <Group>
        <Row anchor="appearance.pageScrollBars">
          <PopUp
            value={scrollBars}
            options={[
              { value: "system", title: "Follow macOS" },
              { value: "thin", title: "Thin" },
            ]}
            onChange={(v) => updateSettings({ pageScrollBars: v })}
            minWidth={140}
          />
        </Row>
      </Group>
    </>
  );
}

function AddressBarChoice({ value, title, selected, onPress }: { value: Settings["addressBar"]; title: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const look = useSettingsColors();
  return (
    <PictureChoice title={title} selected={selected} onPress={onPress} size="m">
      <MiniWindow layout="side" field={value === "sidebar" ? "side" : "toolbar"} look={{ window: look.miniWindow, bar: look.miniBar, field: look.miniField, page: look.miniPage, accent: theme.formAccent }} />
    </PictureChoice>
  );
}

function AppIconPicker() {
  const [choices] = useResource(appIconChoices);
  const icons = choices?.icons ?? [];
  const current = choices?.current ?? null;
  if (icons.length < 2) return null;
  return (
    <>
      <SectionHeader anchor="appearance.appIcon" />
      <View style={ICON_GRID}>
        {icons.map((icon) => (
          <IconChoice key={icon.id} icon={icon} selected={icon.id === current} onPress={() => chooseAppIcon(icon.id)} />
        ))}
      </View>
    </>
  );
}

const ICON_GRID = { flexDirection: "row", flexWrap: "wrap", columnGap: space.s, rowGap: space.ml } as const;
const ICON_IMAGE = { width: APP_ICON_SIZE, height: APP_ICON_SIZE } as const;

function IconChoice({ icon, selected, onPress }: { icon: AppIcon; selected: boolean; onPress: () => void }) {
  return (
    <PictureChoice title={icon.name} selected={selected} onPress={onPress} tooltip={icon.name} size="icon">
      {icon.preview ? <Image source={{ uri: icon.preview }} style={ICON_IMAGE} /> : null}
    </PictureChoice>
  );
}

function ModeChoice({
  mode,
  title,
  description,
  selected,
  onPress,
}: {
  mode: Settings["appearance"];
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const window = (dark: boolean) => {
    const look = modePreview[dark ? "dark" : "light"];
    return <MiniWindow layout="side" look={{ window: look.window, bar: look.line, page: look.page }} />;
  };
  return (
    <PictureChoice title={title} selected={selected} onPress={onPress} tooltip={description} size="m">
      {mode === "auto" ? (
        <>
          {window(false)}
          {window(true)}
        </>
      ) : (
        window(mode === "dark")
      )}
    </PictureChoice>
  );
}
