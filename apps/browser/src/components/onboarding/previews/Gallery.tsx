import {
  devSnapshotWindow,
  DIA,
  setGalleryMock,
  showGalleryPage,
  useGallery,
  type GalleryMock as MockState,
} from "../../../state/onboarding/previewGallery";
import { useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { PROFILE_COLORS, useTheme } from "../../ui/theme";
import type { Settings } from "../../../state/settings/settings";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { openSettings, SETTINGS_WINDOW_ID } from "../../../state/settings/settingsWindows";
import { useOnboardingColors } from "../Parts";
import { onboardingType } from "../tokens";
import { DEMOS } from "./demos";
import type { SceneOpts } from "./scene";
import { PREVIEW_IDS, type PreviewId } from "../../../state/onboarding/previewIds";
import { geo } from "./geometry";
import { lookFor } from "./look";
import { MockWindow } from "./MockWindow";
import { mockInk } from "./tokens";
import { devRegister } from "../../dev/devRegister";

const FRAME_POINTS = [0.2, 0.4, 0.65, 1] as const;
const FRAMES_PER_PAGE = 4;
const FRAME = { width: 186, height: 130 } as const;
const PLUM = PROFILE_COLORS.plum.swatch;
const ARC: Partial<Settings> = { tabLayout: "sidebar", addressBar: "sidebar", commandBarPlacement: "centred", appearance: "dark", extendWebsiteColor: true };

const MOCK_PAGES: MockState[][] = [
  [
    { label: "Dia preset, light, plum", settings: DIA, accent: PLUM, focus: null },
    { label: "Arc preset, dark, blue", settings: ARC, accent: PROFILE_COLORS.blue.swatch, focus: null },
    { label: "Auto appearance, top tabs, green", settings: { tabLayout: "top", appearance: "auto", extendWebsiteColor: true }, accent: PROFILE_COLORS.green.swatch, focus: null },
    { label: "Website color off, orange", settings: { ...DIA, extendWebsiteColor: false }, accent: PROFILE_COLORS.orange.swatch, focus: null },
  ],
  [
    { label: "⌘L field, sidebar address", settings: { ...DIA, addressBar: "sidebar" }, accent: PLUM, focus: "cmdl-field" },
    { label: "⌘L field, toolbar address, dark", settings: { ...DIA, appearance: "dark" }, accent: PROFILE_COLORS.blue.swatch, focus: "cmdl-field" },
    { label: "⌘L centred", settings: DIA, accent: PROFILE_COLORS.purple.swatch, focus: "cmdl-centred" },
    { label: "Website color on", settings: DIA, accent: PLUM, focus: "sitecolor-on" },
  ],
];

function Caption({ text }: { text: string }) {
  const colors = useOnboardingColors();
  return (
    <Text numberOfLines={1} style={{ ...onboardingType.galleryCaption, color: colors.subtitle }}>
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
    <View style={{ ...FRAME, borderRadius: 7, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: dark ? mockInk.frameEdge.dark : mockInk.frameEdge.light }}>
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
  return <MockCell state={{ ...mock, accent: mock.accent ?? PLUM }} width={420} height={300} />;
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

function show(page: Parameters<typeof showGalleryPage>[0]) {
  showGalleryPage(page);
  showSettingsSheet(<PreviewGallery />);
  openSettings();
}

devRegister("acOnboardingPreviews", null, {
  store: useGallery,
  pages: { frames: Math.ceil(PREVIEW_IDS.length / FRAMES_PER_PAGE), mock: MOCK_PAGES.length },
  show,
  hide: closeSettingsSheet,
  setMock: setGalleryMock,
  snapshot: (path: string) => devSnapshotWindow(SETTINGS_WINDOW_ID, path),
});
