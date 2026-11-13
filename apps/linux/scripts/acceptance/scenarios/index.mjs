import f01 from "./f01-page-commands.mjs";
import f02 from "./f02-profiles.mjs";
import f03 from "./f03-site-security.mjs";
import f08 from "./f08-downloads.mjs";
import f09 from "./f09-extensions.mjs";
import f10 from "./f10-suggestions.mjs";
import f23 from "./f23-history-zoom.mjs";
import f26 from "./f26-platform-settings.mjs";
import f27 from "./f27-app-services.mjs";

export const SCENARIOS = [f01, f02, f03, f23, f08, f09, f10, f26, f27];

export function selectScenarios(only, scenarios = SCENARIOS) {
  if (!only?.length) return scenarios;
  const wanted = new Set(only.map((id) => String(id).trim().toUpperCase().replace(/^#/, "")));
  const unknown = [...wanted].filter((id) => !scenarios.some((s) => s.id === id || String(s.issue) === id));
  if (unknown.length) throw new Error(`Unknown scenario ${unknown.join(", ")}; choose from ${scenarios.map((s) => `${s.id} (#${s.issue})`).join(", ")}`);
  return scenarios.filter((s) => wanted.has(s.id) || wanted.has(String(s.issue)));
}
