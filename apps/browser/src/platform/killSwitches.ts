import { readDocument, writeDocument } from "@ardia/shell";
import { switchOverride } from "./launchConfig";

type SwitchDef = {
  about: string;
  owner: string;
  removeBy: string;
  live: boolean;
};

type ExperimentDef = {
  about: string;
  owner: string;
  removeBy: string;
};

export const MAX_SWITCHES = 8;

export const SWITCHES = {
  newTabPrewarm: {
    about: "A New Tab page's engine tab is made a moment after it opens, so Enter only navigates it (lib/preload.ts).",
    owner: "command bar",
    removeBy: "2026-12-15",
    live: true,
  },
  lazySidebarRows: {
    about: "A launch mounts only the sidebar rows its window shows, and the profile pages beside it a frame later (Sidebar.tsx).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: false,
  },
  updatePrewarm: {
    about: "An update staged for install-on-quit is run once, hidden, so its first launch skips macOS's first-exec checks (Updater.swift).",
    owner: "updater",
    removeBy: "2026-12-15",
    live: true,
  },
  launchTab: {
    about: "The focused window's page starts loading as the app starts, before its window is up (store/launchTab.ts).",
    owner: "launch",
    removeBy: "2026-12-15",
    live: false,
  },
  focusedWindowFirst: {
    about: "A launch with several windows builds the focused one first and opens the others behind it after (lib/windowOpenOrder.ts).",
    owner: "launch",
    removeBy: "2026-12-15",
    live: false,
  },
  sidebarSlide: {
    about: "Hiding or showing the sidebar or the top tab strip (⌘S) slides it and the card's edge (Arc's motions and toolbar-less card with the address bar in the sidebar); off, they jump (layout/SidebarDock.tsx).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: true,
  },
  sidebarSlideLean: {
    about: "The sidebar's slide draws the traffic lights' moves and lays them out once they stop (packages/shell ChromeWindows.swift).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: false,
  },
  chromeBatterySaver: {
    about: "Battery Saver is Chrome's own (its battery saver mode: busy background tabs freeze, frame rate and timers are reduced); off, our sampler freezes busy background tabs over CDP (lib/tabLifecycle.ts).",
    owner: "tab lifecycle",
    removeBy: "2026-12-15",
    live: false,
  },
} as const satisfies Record<string, SwitchDef>;

export const EXPERIMENTS = {
  beginFrameBridge: {
    about: "While a shown tab waits for the display link's first callback, the GPU process sends up to 4 warm-up BeginFrames on the display's last vsync grid (engine, chromium-begin-frame-warm-up.patch).",
    owner: "tab switch",
    removeBy: "2026-12-15",
  },
  serverWindowDrag: {
    about: "The window server moves the window from our drag areas at once, instead of waiting for mouseDown on the main thread (packages/shell ServerWindowDrag.swift).",
    owner: "window",
    removeBy: "2026-12-15",
  },
  serverWindowDragAllOpen: {
    about: "As serverWindowDrag, with every view in the titlebar band left open to window moves (a probe for the geometry work).",
    owner: "window",
    removeBy: "2026-12-15",
  },
  webkitSignIn: {
    about: "Moving a Chromium page to WebKit first copies the cookies that page's own address gets into the profile's WebKit store, at most 1.5 s (state/engines/engineSignIn.ts).",
    owner: "engines",
    removeBy: "2026-12-15",
  },
} as const satisfies Record<string, ExperimentDef>;

type SwitchName = keyof typeof SWITCHES;
type ExperimentName = keyof typeof EXPERIMENTS;

const CACHE_DOC = "switches-cache.json";
const SWITCHES_URL = "https://ardia.dev/switches.json";
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 4096;

type Values = Partial<Record<SwitchName, boolean>>;

const known = (name: string): name is SwitchName => Object.hasOwn(SWITCHES, name);

function parseSwitches(json: string | null | undefined): Values {
  const out: Values = {};
  try {
    const switches = (JSON.parse(json ?? "") as { switches?: Record<string, unknown> } | null)?.switches;
    if (switches && typeof switches === "object")
      for (const [name, value] of Object.entries(switches)) if (known(name) && typeof value === "boolean") out[name] = value;
  } catch {}
  return out;
}

let cached: Values = {};
let loaded = false;

function load() {
  loaded = true;
  try {
    cached = parseSwitches(readDocument(CACHE_DOC));
  } catch {
    cached = {};
  }
}

export function switchOn(name: SwitchName): boolean {
  if (!loaded) load();
  return switchOverride(name) ?? cached[name] ?? true;
}

export const experimentOn = (name: ExperimentName): boolean => switchOverride(name) ?? false;

export function reloadSwitches() {
  loaded = false;
  cached = {};
}

let fetchedThisLaunch = false;

type RefreshResult = "updated" | "failed" | "already";

export async function refreshSwitches(fetchFn: typeof fetch = fetch): Promise<RefreshResult> {
  if (fetchedThisLaunch) return "already";
  fetchedThisLaunch = true;
  if (!loaded) load();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(SWITCHES_URL, { method: "GET", credentials: "omit", cache: "no-store", signal: abort.signal });
    if (!response.ok) return "failed";
    const text = await response.text();
    if (text.length > MAX_BYTES) return "failed";
    const parsed = JSON.parse(text) as { version?: unknown; switches?: unknown };
    if (parsed?.version !== 1 || !parsed.switches || typeof parsed.switches !== "object") return "failed";
    const values = parseSwitches(text);
    writeDocument(CACHE_DOC, JSON.stringify({ version: 1, switches: values }));
    const next: Values = { ...cached };
    for (const name of Object.keys(SWITCHES) as SwitchName[]) if (SWITCHES[name].live) next[name] = values[name];
    cached = next;
    return "updated";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export const resetRefreshForTests = () => void (fetchedThisLaunch = false);
