export const APP_INGEST_KEY = "ak_app_41b5d0762fd8ade6949ac2ac";
export const CLI_INGEST_KEY = "ak_cli_67adb8ebc49841125eda860e";
export const SITE_INGEST_KEY = "ak_site_6b26588b3764ae7d0f6d63d7";

export const INGEST_KEY_HEADER = "X-Ardia-Key";

export type IngestSource = "app" | "cli" | "site";

export const INGEST_KEYS: Readonly<Record<IngestSource, string>> = {
  app: APP_INGEST_KEY,
  cli: CLI_INGEST_KEY,
  site: SITE_INGEST_KEY,
};

export function ingestSourceOf(key: string | null | undefined): IngestSource | null {
  for (const [source, value] of Object.entries(INGEST_KEYS)) if (key === value) return source as IngestSource;
  return null;
}
