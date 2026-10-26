import { create } from "zustand";
import type { Settings } from "../settings/settings";
import type { PreviewId } from "./previewIds";

export { devSnapshotWindow } from "../../platform/app";

export type GalleryMock = { label: string; settings: Partial<Settings>; accent: string; focus: PreviewId | null };

type GalleryPage = { kind: "frames"; index: number; addressInSidebar?: boolean } | { kind: "mock"; index: number } | { kind: "mockLive" };

type LiveMock = Omit<GalleryMock, "accent"> & { accent: string | null };

type GalleryState = { page: GalleryPage; mock: LiveMock };

export const DIA: Partial<Settings> = { tabLayout: "sidebar", addressBar: "toolbar", commandBarPlacement: "field", appearance: "light", extendWebsiteColor: true };

export const useGallery = create<GalleryState>()(() => ({
  page: { kind: "frames", index: 0 },
  mock: { label: "live", settings: DIA, accent: null, focus: null },
}));

export const showGalleryPage = (page: GalleryPage) => useGallery.setState({ page });

export function setGalleryMock(patch: Partial<GalleryMock> & { settingsPatch?: Partial<Settings> }) {
  const { settingsPatch, ...rest } = patch;
  useGallery.setState((s) => ({ mock: { ...s.mock, ...rest, settings: { ...s.mock.settings, ...rest.settings, ...settingsPatch } } }));
}
