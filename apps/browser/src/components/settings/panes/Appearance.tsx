import { setAppearance, setAppIcon, type AppIcon } from "../../../state/app/appSettings";
import { Symbol, font, PopUp, Toggle, useHover } from "../../ui";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useSettings, useTabLayout } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import type { Settings } from "../../../state/settings/settings";
import { Group, Row, SectionHeader } from "../Form";
import { PictureChoice } from "../PictureChoice";
import { modePreview } from "../tokens";
import { useSettingsColors } from "../useSettingsColors";
import { APP_ICON_SIZE, appIconChoices } from "../../../state/settings/paneData";
import { store, useResource } from "../../../state/settings/resources";

const MODES: { value: Settings["appearance"]; title: string; description: string }[] = [
  { value: "auto", title: "Automatic", description: "Follow the system appearance setting" },
  { value: "light", title: "Light", description: "Use the light application appearance" },
  { value: "dark", title: "Dark", description: "Use the dark application appearance" },
];

export function AppearancePane() {
  const appearance = useSettings((s) => s.appearance);
  const spacesFollow = useSettings((s) => s.spacesFollowAppearance);
  const choose = (mode: Settings["appearance"]) => {
    updateSettings({ appearance: mode });
    void setAppearance(mode);
  };
  return (
    <View>
      <SectionHeader anchor="appearance.theme" description="Also in View › Appearance. Incognito windows are always dark." />
      <View style={{ flexDirection: "row", gap: 14 }}>
        {MODES.map((m) => (
          <ModeChoice key={m.value} mode={m.value} title={m.title} description={m.description} selected={appearance === m.value} onPress={() => choose(m.value)} />
        ))}
      </View>
      <Group style={{ marginTop: 14 }}>
        <Row anchor="appearance.spacesFollowAppearance">
          <Toggle value={spacesFollow} onChange={(v) => updateSettings({ spacesFollowAppearance: v })} />
        </Row>
      </Group>
      <AddressBarPicker />
      <SelectedTabGlowPicker />
      <ScrollBarsPicker />
      <AppIconPicker />
    </View>
  );
}

function AddressBarPicker() {
  const addressBar = useSettings((s) => s.addressBar);
  const placement = useSettings((s) => s.commandBarPlacement);
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
      <View style={{ flexDirection: "row", gap: 14 }}>
        <AddressBarChoice value="toolbar" title="In the toolbar" selected={addressBar !== "sidebar"} onPress={() => choose("toolbar")} />
        <AddressBarChoice value="sidebar" title="In the sidebar" selected={addressBar === "sidebar"} onPress={() => choose("sidebar")} />
      </View>
      <Group style={{ marginTop: 14 }}>
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
      </Group>
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
  const sidebar = value === "sidebar";
  return (
    <PictureChoice title={title} selected={selected} onPress={onPress} gap={7} frame={{ height: 84, borderRadius: 9, padding: 6, flexDirection: "row", gap: 5, backgroundColor: look.miniWindow }}>
      <View style={{ width: "28%", gap: 3, paddingTop: sidebar ? 3 : 8 }}>
        {sidebar && <View style={{ height: 8, borderRadius: 3, marginBottom: 2, backgroundColor: look.miniField, borderWidth: 1, borderColor: theme.formAccent }} />}
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ height: 5, borderRadius: 2.5, backgroundColor: look.miniBar }} />
        ))}
      </View>
      <View style={{ flex: 1, borderRadius: 4, backgroundColor: look.miniPage, overflow: "hidden" }}>
        {!sidebar && (
          <View style={{ height: 13, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, gap: 5, borderBottomWidth: 1, borderBottomColor: look.miniField }}>
            <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: look.miniBar }} />
            <View style={{ flex: 1, height: 7, borderRadius: 2.5, backgroundColor: look.miniField, borderWidth: 1, borderColor: theme.formAccent }} />
          </View>
        )}
      </View>
    </PictureChoice>
  );
}

function AppIconPicker() {
  const [choices] = useResource(appIconChoices);
  const icons = choices?.icons ?? [];
  const current = choices?.current ?? null;
  if (icons.length < 2) return null;
  const choose = (id: string) => {
    store(appIconChoices, [], { icons, current: id });
    void setAppIcon(id);
  };
  return (
    <>
      <SectionHeader anchor="appearance.appIcon" description="Shown in the Dock and the app switcher. The Dock keeps it after you quit." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 6, rowGap: 10 }}>
        {icons.map((icon) => (
          <IconChoice key={icon.id} icon={icon} selected={icon.id === current} onPress={() => choose(icon.id)} />
        ))}
      </View>
    </>
  );
}

const ICON_SIZE = APP_ICON_SIZE;

function IconChoice({ icon, selected, onPress }: { icon: AppIcon; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable onPress={onPress} {...hoverProps} style={{ width: 72, alignItems: "center", gap: 5 }} tooltip={icon.name}>
      <View
        style={{
          width: 70,
          height: 70,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2.5,
          borderColor: selected ? theme.formAccent : "transparent",
          backgroundColor: hovered && !selected ? theme.rowHover : "transparent",
        }}
      >
        {icon.preview ? <Image source={{ uri: icon.preview }} style={{ width: ICON_SIZE, height: ICON_SIZE }} /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={11} color={theme.formAccent} style={{ width: 13, height: 13 }} />}
        <Text numberOfLines={1} style={{ ...font.small, color: selected ? theme.textPrimary : theme.textSecondary }}>
          {icon.name}
        </Text>
      </View>
    </Pressable>
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
    return (
      <View style={{ flex: 1, backgroundColor: look.window, padding: 6, flexDirection: "row", gap: 5 }}>
        <View style={{ width: "24%", gap: 3, paddingTop: 8 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 5, borderRadius: 2.5, backgroundColor: look.line }} />
          ))}
        </View>
        <View style={{ flex: 1, borderRadius: 4, backgroundColor: look.page }} />
      </View>
    );
  };
  return (
    <PictureChoice title={title} selected={selected} onPress={onPress} tooltip={description} gap={7} frame={{ height: 84, borderRadius: 9, overflow: "hidden", flexDirection: "row" }}>
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
