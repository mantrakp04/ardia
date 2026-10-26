import { setAutoPictureInPicture, setDisplayMediaPicker, setVideoUpscaling } from "../../platform/media";
import { useRef } from "react";
import { useBrowser } from "../browser/store";
import { useStoreWhile } from "../tabs/tabWatch";
import { usePages } from "../tabs/pageState";
import { startCast } from "./cast";
import { cancelDisplayMediaOnNavigation, startTabShareCleanup } from "./screenShare";

export function useAutoPictureInPicture(tabId: string, visible: boolean): boolean {
  const enabled = useStoreWhile(useBrowser, visible, (s) => s.settings.autoPictureInPicture ?? true);
  const audible = useStoreWhile(useBrowser, visible, (s) => !!s.live[tabId]?.playingAudio);
  const capturing = useStoreWhile(usePages, visible, (s) => !!s.pages[tabId]?.mediaAccess);
  const decided = useRef(false);
  if (visible) decided.current = enabled && (audible || capturing);
  return decided.current;
}

let started = false;

export function startMedia() {
  if (started) return;
  started = true;
  void setDisplayMediaPicker(true);
  let autoPip: boolean | null = null;
  const syncAutoPip = () => {
    const on = useBrowser.getState().settings.autoPictureInPicture ?? true;
    if (on !== autoPip) void setAutoPictureInPicture((autoPip = on));
  };
  let upscaling: boolean | null = null;
  const syncUpscaling = () => {
    const on = useBrowser.getState().settings.videoUpscaling ?? true;
    if (on !== upscaling) void setVideoUpscaling((upscaling = on));
  };
  const syncSettings = () => {
    syncAutoPip();
    syncUpscaling();
  };
  syncSettings();
  useBrowser.subscribe(syncSettings);
  cancelDisplayMediaOnNavigation();
  startTabShareCleanup();
  startCast();
}
