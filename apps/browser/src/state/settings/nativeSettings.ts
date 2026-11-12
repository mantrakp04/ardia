import { setAppearance, setThinScrollBars } from "../../platform/app";
import { setAutoPictureInPicture, setVideoUpscaling } from "../../platform/media";
import { setCommandScrollZoom } from "../../platform/siteSettings";
import { useBrowser } from "../browser/store";
import type { Settings } from "./settings";

type Mirror = { key: keyof Settings; send: (settings: Settings) => unknown };

const mirror = <K extends keyof Settings>(key: K, send: (value: Settings[K]) => unknown): Mirror => ({ key, send: (settings) => send(settings[key]) });

const NATIVE_SETTINGS: Mirror[] = [
  mirror("appearance", setAppearance),
  mirror("pageScrollBars", (bars) => setThinScrollBars(bars === "thin")),
  mirror("autoPictureInPicture", setAutoPictureInPicture),
  mirror("videoUpscaling", setVideoUpscaling),
  mirror("commandScrollZoom", setCommandScrollZoom),
];

export function startNativeSettings() {
  const sent = new Map<keyof Settings, unknown>();
  const sync = (settings: Settings) => {
    for (const { key, send } of NATIVE_SETTINGS) {
      if (sent.has(key) && sent.get(key) === settings[key]) continue;
      sent.set(key, settings[key]);
      void send(settings);
    }
  };
  sync(useBrowser.getState().settings);
  return useBrowser.subscribe((s, prev) => s.settings !== prev.settings && sync(s.settings));
}
