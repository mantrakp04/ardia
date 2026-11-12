export type PlatformTerms = {
  computer: string;
  os: string;
  fileManager: string;
  trash: string;
  dock: string;
};

export type PlatformIds = { report: string; otel: string };

export const PLATFORM_IDS: PlatformIds = { report: "macos", otel: "darwin" };

export const PLATFORM_TERMS: PlatformTerms = { computer: "Mac", os: "macOS", fileManager: "Finder", trash: "Trash", dock: "Dock" };
