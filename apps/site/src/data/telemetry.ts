export const PRODUCTION_HOSTS = ["ardia.dev", "www.ardia.dev", "netnyahoo.com", "www.netnyahoo.com"];

export const DEV_OPT_IN_KEY = "ac:telemetry";

export const LOGS_PATH = "/otel/v1/logs";
export const REPLAY_PATH = "/otel/replay";

export const SITE_SOURCES = ["ardia-site", "netnyahoo-site"];
export const SITE_LIBS = ["ardia-web", "web", "netnyahoo-web"];
export const APP_SOURCES = ["ardia-app", "netnyahoo-app"];
export const APP_LIBS = ["ardia-telemetry", "netnyahoo-telemetry"];
export const DAILY_LIB = "ardia-daily";
export const HISTORY_SOURCE = "posthog-cloud";
export const SERVICE_NAME = SITE_SOURCES[0];
export const WEB_LIB = SITE_LIBS[0];

export const SITE_EVENTS = [
  "download_clicked",
  "github_clicked",
  "discord_clicked",
  "notify_clicked",
  "screenshot_opened",
  "section_viewed",
  "press_kit_opened",
  "press_kit_downloaded",
  "demo_customize",
  "demo_setup_code_shown",
  "demo_setup_code_copied",
  "game_solved",
  "release_notes_viewed",
  "send_to_mac_clicked",
  "mac_link_visit",
  "non_mac_visit",
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

export const AUTO_EVENTS = [
  "$pageview",
  "$pageleave",
  "$autocapture",
  "$rageclick",
  "$dead_click",
  "$dead_swipe",
  "$exception",
  "$web_vitals",
  "$feature_flag_called",
  "$experiment_exposure",
  "$replay_chunk",
] as const;
export type TelemetryEvent = SiteEvent | (typeof AUTO_EVENTS)[number];

export type ChosenDevice = "mac" | "phone";
const DEVICE_BEFORE_ARDIA_DEVICE: Record<ChosenDevice, (prop: (key: string) => string) => string> = {
  mac: (prop) => `${prop("$os")} = 'Mac OS X' AND ${prop("$device_type")} = 'Desktop'`,
  phone: (prop) => `${prop("$device_type")} IN ('Mobile', 'Tablet')`,
};
export const visitorOnSql = (device: ChosenDevice, prop: (key: string) => string) =>
  `if(${prop("ardia_device")} = '', ${DEVICE_BEFORE_ARDIA_DEVICE[device](prop)}, ${prop("ardia_device")} = '${device}')`;

export const EXTENSION_FRAME = /^(chrome|moz|safari(-web)?)-extension:/;

export function classifyNoise({ message, frames, userAgent }: { message: string; frames: { filename?: string }[]; userAgent: string }) {
  if (/^Script error\.?$/.test(message)) return "cross-origin Script error.";
  if (frames.some((f) => EXTENSION_FRAME.test(f.filename ?? ""))) return "browser extension";
  if (/webkit\.messageHandlers|Twitter for|Instagram|FBAN|FBAV/.test(message + userAgent)) return "in-app browser";
  if (/Non-Error promise rejection captured with value: \{\}/.test(message)) return "Safari empty promise rejection (known)";
  if (/ResizeObserver loop/.test(message)) return "ResizeObserver";
  if (/Load failed|Failed to fetch|NetworkError|network error/i.test(message)) return "network drop";
  if (/wallet|ethereum|solana|metamask|LavaMoat/i.test(message)) return "wallet extension";
  return null;
}

export const REPLAY_BODY_LIMIT_MB = 2;
export const REPLAY_MAX_CHUNK_BYTES = 1_900_000;
export const REPLAY_SEQ_DIGITS = 6;
export const REPLAY_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const REPLAY_OBJECT = /^(\d+)\.json(\.gz)?$/;
export const replayObjectName = (seq: number, gzipped: boolean) => `${seq}.json${gzipped ? ".gz" : ""}`;
export const replayUploadPath = (sessionId: string, seq: number, gzipped: boolean) =>
  `${REPLAY_PATH}/${sessionId}/${replayObjectName(seq, gzipped)}`;

export const LEGACY_VISITOR_ID_KEY = "ph_phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY_posthog";

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

export const FLUSH_MS = 3000;
export const SCROLL_SAMPLE_MS = 100;

export const REPLAY_MIN_SESSION_MS = 4000;
export const REPLAY_SAMPLE_RATE = 1;
export const REPLAY_CHUNK_MS = 5000;
export const REPLAY_START_AFTER_LOAD_MS = 2500;
export const REPLAY_START_IDLE_MS = 2000;
export const PRIVATE_SELECTOR = ".ac-private, [data-private]";
export const BLOCK_SELECTOR = ".ac-block, [data-private-block], .demo-frame";

export const FLAGS = {
  "download-band": {
    id: 293364,
    version: 2,
    rollout: 100,
    variants: [
      { key: "control", rollout: 50 },
      { key: "band", rollout: 50 },
    ],
    experiment: true,
  },
} as const;
export type FlagKey = keyof typeof FLAGS;
