import { devSnapshotWindow } from "@ardia/shell";
import { useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { useTheme } from "../../../lib/theme";
import type { Settings } from "../../../store/settings";
import { closeSettingsSheet, showSettingsSheet } from "../../settings/sheet";
import { openSettings, SETTINGS_WINDOW_ID } from "../../settings/windows";
import { useOnboardingColors } from "../ui";
import { DEMOS, type SceneOpts } from "./demos";
import { PREVIEW_IDS, type PreviewId } from "./ids";
import { geo, lookFor } from "./kit";
import { MockWindow } from "./MockWindow";

type MockState = { label: string; settings: Partial<Settings>; accent: string; focus: PreviewId | null };

type GalleryPage = { kind: "frames"; index: number; addressInSidebar?: boolean } | { kind: "mock"; index: number } | { kind: "mockLive" };

type GalleryState = { page: GalleryPage; mock: MockState };

const FRAME_POINTS = [0.2, 0.4, 0.65, 1] as const;
const FRAMES_PER_PAGE = 4;
const FRAME = { width: 186, height: 130 } as const;
const PLUM = "#C07A98";

const DIA: Partial<Settings> = { tabLayout: "sidebar", addressBar: "toolbar", commandBarPlacement: "field", appearance: "light", extendWebsiteColor: true };
const ARC: Partial<Settings> = { tabLayout: "sidebar", addressBar: "sidebar", commandBarPlacement: "centred", appearance: "dark", extendWebsiteColor: true };

const MOCK_PAGES: MockState[][] = [
  [
    { label: "Dia preset, light, plum", settings: DIA, accent: PLUM, focus: null },
    { label: "Arc preset, dark, blue", settings: ARC, accent: "#4691C3", focus: null },
    { label: "Auto appearance, top tabs, green", settings: { tabLayout: "top", appearance: "auto", extendWebsiteColor: true }, accent: "#3EB489", focus: null },
    { label: "Website color off, orange", settings: { ...DIA, extendWebsiteColor: false }, accent: "#D87249", focus: null },
  ],
  [
    { label: "⌘L field, sidebar address", settings: { ...DIA, addressBar: "sidebar" }, accent: PLUM, focus: "cmdl-field" },
    { label: "⌘L field, toolbar address, dark", settings: { ...DIA, appearance: "dark" }, accent: "#4691C3", focus: "cmdl-field" },
    { label: "⌘L centred", settings: DIA, accent: "#7873AF", focus: "cmdl-centred" },
    { label: "Website color on", settings: DIA, accent: PLUM, focus: "sitecolor-on" },
  ],
];

const useGallery = create<GalleryState>(() => ({
  page: { kind: "frames", index: 0 },
  mock: { label: "live", settings: DIA, accent: PLUM, focus: null },
}));

function Caption({ text }: { text: string }) {
  const colors = useOnboardingColors();
  return (
    <Text numberOfLines={1} style={{ fontSize: 10.5, lineHeight: 14, fontWeight: "500", color: colors.subtitle }}>
      {text}
    </Text>
  );
}

function FixedFrame({ id, at, opts }: { id: PreviewId; at: number; opts: SceneOpts }) {
  const dark = useTheme().dark;
  const p = useRef(new Animated.Value(at)).current;
  const g = useMemo(() => geo(FRAME.width, FRAME.height), []);
  const { Scene } = DEMOS[id];
  return (
    <View style={{ ...FRAME, borderRadius: 7, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: dark ? "#FFFFFF33" : "#00000026" }}>
      <Scene g={g} look={lookFor(dark, PLUM)} p={p} opts={opts} />
    </View>
  );
}

function FramesPage({ index, addressInSidebar }: { index: number; addressInSidebar: boolean }) {
  const systemDark = useTheme().dark;
  const opts = useMemo<SceneOpts>(() => ({ addressInSidebar, systemDark, accent: PLUM }), [addressInSidebar, systemDark]);
  const ids = PREVIEW_IDS.slice(index * FRAMES_PER_PAGE, (index + 1) * FRAMES_PER_PAGE);
  return (
    <View style={{ gap: 6 }}>
      {ids.map((id) => (
        <View key={id} style={{ gap: 2 }}>
          <Caption text={`${id} · ${DEMOS[id].duration} ms · ${FRAME_POINTS.map((f) => Math.round(f * DEMOS[id].duration)).join(" / ")} ms${addressInSidebar ? " · sidebar address" : ""}`} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {FRAME_POINTS.map((f) => (
              <FixedFrame key={f} id={id} at={f} opts={opts} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function MockCell({ state, width, height }: { state: MockState; width: number; height: number }) {
  return (
    <View style={{ gap: 2 }}>
      <Caption text={state.label} />
      <View style={{ width, height }}>
        <MockWindow settings={state.settings} accent={state.accent} focus={state.focus} />
      </View>
    </View>
  );
}

function MockPage({ index }: { index: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, width: 2 * 380 + 16 }}>
      {(MOCK_PAGES[index] ?? []).map((state) => (
        <MockCell key={state.label} state={state} width={380} height={272} />
      ))}
    </View>
  );
}

function MockLivePage() {
  const mock = useGallery((s) => s.mock);
  return <MockCell state={mock} width={420} height={300} />;
}

function PreviewGallery() {
  const colors = useOnboardingColors();
  const page = useGallery((s) => s.page);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, paddingTop: 30, paddingHorizontal: 18 }]}>
      {page.kind === "frames" && <FramesPage index={page.index} addressInSidebar={!!page.addressInSidebar} />}
      {page.kind === "mock" && <MockPage index={page.index} />}
      {page.kind === "mockLive" && <MockLivePage />}
    </View>
  );
}

function show(page: GalleryPage) {
  useGallery.setState({ page });
  showSettingsSheet(<PreviewGallery />);
  openSettings();
}

function setMock(patch: Partial<MockState> & { settingsPatch?: Partial<Settings> }) {
  const { settingsPatch, ...rest } = patch;
  useGallery.setState((s) => ({ mock: { ...s.mock, ...rest, settings: { ...s.mock.settings, ...rest.settings, ...settingsPatch } } }));
}

(globalThis as { acOnboardingPreviews?: unknown }).acOnboardingPreviews = {
  store: useGallery,
  pages: { frames: Math.ceil(PREVIEW_IDS.length / FRAMES_PER_PAGE), mock: MOCK_PAGES.length },
  show,
  hide: closeSettingsSheet,
  setMock,
  snapshot: (path: string) => devSnapshotWindow(SETTINGS_WINDOW_ID, path),
};
