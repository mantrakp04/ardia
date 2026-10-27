export const PRODUCTION_HOSTS = ["ardia.dev", "www.ardia.dev", "netnyahoo.com", "www.netnyahoo.com"];

export const DEV_OPT_IN_KEY = "ac:telemetry";

export const LOGS_PATH = "/otel/v1/logs";
export const REPLAY_PATH = "/otel/replay";

export const SERVICE_NAME = "ardia-site";

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
