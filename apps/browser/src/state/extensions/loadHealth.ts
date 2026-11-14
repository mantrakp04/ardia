import { extensionsLoadHealth } from "../../platform/extensions";
import { capture } from "../telemetry/client";

const reported = new Set<string>();

const DISABLE_REASONS = ["user", "permissions", "corrupted", "developer", "unsupported", "policy", "external", "reload", "other"] as const;

export function reportExtensionsLoaded(profile: string) {
  if (reported.has(profile)) return;
  reported.add(profile);
  extensionsLoadHealth(profile).then(
    ({ dropped, enabled, disabled }) => {
      const props: Record<string, unknown> = { profile_kind: profile === "" ? "default" : "other", dropped, enabled };
      for (const reason of DISABLE_REASONS) props[`disabled_${reason}`] = disabled[reason] ?? 0;
      capture("extensions_loaded", props);
    },
    (error: unknown) => console.warn("[extensions] load health failed", error),
  );
}
