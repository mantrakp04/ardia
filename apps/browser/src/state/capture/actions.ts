import type { CaptureResult } from "../../platform/tabs";
import { webviews } from "../../platform/webviews";
import { getDownloadSettings } from "../../platform/downloads";
import { revealFile } from "../../platform/files";
import { displayHostOf } from "../../lib/url";
import { currentEngineProfile, currentTab } from "../browser/current";
import { showToast } from "../app/toasts";
import { noteCaptureEnded, noteCaptureSaved, noteCaptureStarted } from "../telemetry/captureCounts";

const TOAST_KEY = "capture";

export async function toggleCapture(tabId: string) {
  const started = await webviews.get(tabId)?.toggleCapture();
  if (started) noteCaptureStarted();
}

export function captureEnded(tabId: string, result: CaptureResult) {
  noteCaptureEnded(result);
  const tab = currentTab(tabId);
  if (!tab) return;
  if (result.outcome === "failed") return showToast(tab.windowId, "Couldn't capture the page", undefined, { icon: "exclamationmark.triangle", key: TOAST_KEY });
  if (result.outcome !== "copied") return;
  showToast(tab.windowId, "Capture copied", `${result.width} × ${result.height}`, {
    icon: "camera.viewfinder",
    key: TOAST_KEY,
    action: { title: "Save", run: () => void saveCapture(tabId) },
  });
}

export function captureFileName(url: string, at: Date) {
  const host = displayHostOf(url) || "Page";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  return `Capture ${host} ${day} at ${time}`;
}

async function saveCapture(tabId: string) {
  const tab = currentTab(tabId);
  const web = webviews.get(tabId);
  if (!tab || !web) return;
  const settings = await getDownloadSettings(currentEngineProfile(tab.profileId)).catch(() => null);
  const path = settings?.folder ? await web.saveCapture(settings.folder, captureFileName(tab.url, new Date())) : null;
  if (!path) return showToast(tab.windowId, "Couldn't save the capture", undefined, { icon: "exclamationmark.triangle", key: TOAST_KEY });
  noteCaptureSaved();
  showToast(tab.windowId, "Capture saved", path.split("/").pop(), {
    icon: "photo",
    key: TOAST_KEY,
    action: { title: "Show in Finder", run: () => void revealFile(path) },
  });
}
