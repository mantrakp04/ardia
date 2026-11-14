import type { CaptureResult } from "../../platform/tabs";
import { webviews } from "../../platform/webviews";
import { getDownloadSettings } from "../../platform/downloads";
import { revealFile } from "../../platform/files";
import { saveCaptureImage } from "../../platform/capture";
import { displayHostOf } from "../../lib/url";
import { currentEngineProfile, currentTab } from "../browser/current";
import { showToast } from "../app/toasts";
import { noteCaptureEnded, noteCaptureSaved, noteCaptureStarted } from "../telemetry/captureCounts";

const TOAST_KEY = "capture";

export async function toggleCapture(tabId: string) {
  const started = await webviews.get(tabId)?.toggleCapture();
  if (started) noteCaptureStarted();
}

type CaptureToSave = { capture: number; windowId: string; profileId: string; url: string };

export function captureEnded(tabId: string, result: CaptureResult) {
  noteCaptureEnded(result);
  const tab = currentTab(tabId);
  if (!tab) return;
  if (result.outcome === "failed") return showToast(tab.windowId, "Couldn't capture the page", undefined, { icon: "exclamationmark.triangle", key: TOAST_KEY });
  if (result.outcome !== "copied") return;
  const saving = result.capture === undefined ? null : { capture: result.capture, windowId: tab.windowId, profileId: tab.profileId, url: tab.url };
  showToast(tab.windowId, "Capture copied", `${result.width} × ${result.height}`, {
    icon: "camera.viewfinder",
    key: TOAST_KEY,
    ...(saving ? { action: { title: "Save", run: () => void saveCapture(saving) } } : {}),
  });
}

export function captureFileName(url: string, at: Date) {
  const host = displayHostOf(url) || "Page";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  return `Capture ${host} ${day} at ${time}`;
}

async function saveCapture({ capture, windowId, profileId, url }: CaptureToSave) {
  const settings = await getDownloadSettings(currentEngineProfile(profileId)).catch(() => null);
  const path = settings?.folder ? await saveCaptureImage(capture, settings.folder, captureFileName(url, new Date())).catch(() => null) : null;
  if (!path) return showToast(windowId, "Couldn't save the capture", undefined, { icon: "exclamationmark.triangle", key: TOAST_KEY });
  noteCaptureSaved();
  showToast(windowId, "Capture saved", path.split("/").pop(), {
    icon: "photo",
    key: TOAST_KEY,
    action: { title: "Show in Finder", run: () => void revealFile(path) },
  });
}
