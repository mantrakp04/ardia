import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_PROFILE = "default";

export function documentDirectory(scratch) {
  return join(scratch, "Default", "Ardia");
}

export function sessionPath(scratch) {
  return join(documentDirectory(scratch), "linux-session.json");
}

export function sessionSeed({ windows = [{ id: "main", urls: [""] }], settings = {}, focused } = {}) {
  const profileId = DEFAULT_PROFILE;
  const seed = {
    profiles: { [profileId]: { id: profileId, name: "Personal", color: "plum", icon: null, createdAt: 1 } },
    profileOrder: [profileId],
    windows: {},
    windowOrder: [],
    tabs: {},
    focusedWindowId: focused ?? windows[0]?.id ?? null,
    settings: { restoreSession: true, ...settings },
  };
  windows.forEach((window, windowIndex) => {
    const tabIds = window.urls.map((_, tabIndex) => `${window.id}-tab-${tabIndex}`);
    window.urls.forEach((url, tabIndex) => {
      const id = tabIds[tabIndex];
      seed.tabs[id] = { id, windowId: window.id, profileId, url, title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: 1 + tabIndex, lastActiveAt: 1 + tabIndex };
    });
    seed.windows[window.id] = { id: window.id, profileId, kind: "main", tabIds, activeTabIds: { [profileId]: tabIds[tabIds.length - 1] }, sidebarOpen: true, frame: window.frame ?? [24 + windowIndex * 40, 24 + windowIndex * 40, 1280, 800], createdAt: 1 + windowIndex };
    seed.windowOrder.push(window.id);
  });
  return seed;
}

export const COMPLETED_ONBOARDING = JSON.stringify({ completedAt: 1, version: 1 });

export async function writeProfileSeed(scratch, { session, onboardingComplete = true, documents = {} } = {}) {
  const directory = documentDirectory(scratch);
  await mkdir(directory, { recursive: true });
  if (session) await writeFile(sessionPath(scratch), JSON.stringify(session));
  if (onboardingComplete) await writeFile(join(directory, "onboarding.json"), COMPLETED_ONBOARDING);
  for (const [name, text] of Object.entries(documents)) await writeFile(join(directory, name), text);
}

export async function writeChromePreferences(scratch, { downloads, printToPdf = false } = {}) {
  const directory = join(scratch, "Default");
  await mkdir(directory, { recursive: true });
  const preferences = {
    browser: { has_seen_welcome_page: true },
    download: downloads ? { default_directory: downloads, prompt_for_download: false, directory_upgrade: true } : undefined,
    savefile: downloads ? { default_directory: downloads } : undefined,
    printing: printToPdf
      ? { print_preview_sticky_settings: { appState: JSON.stringify({ version: 2, recentDestinations: [{ id: "Save as PDF", origin: "local", account: "" }], isHeaderFooterEnabled: false }) } }
      : undefined,
  };
  await writeFile(join(directory, "Preferences"), JSON.stringify(preferences));
}
