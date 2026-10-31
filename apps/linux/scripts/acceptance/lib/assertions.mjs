export const SITE_PANEL_TEXT = {
  secure: "Connection is secure",
  insecure: "Connection is not secure",
  local: "This is a local or internal page",
  unavailable: "Connection information unavailable",
  mixed: "Parts of this page aren't secure",
  certificateError: "The site's certificate isn't valid",
  localChip: "Local Page",
};

export function classifySitePanel(text) {
  const t = String(text ?? "");
  const has = (key) => t.includes(SITE_PANEL_TEXT[key]);
  const local = has("local") || has("localChip");
  if (has("certificateError")) return { level: "certificateError", local };
  if (has("mixed")) return { level: "mixed", local };
  if (has("secure")) return { level: "secure", local };
  if (has("insecure")) return { level: "insecure", local };
  if (has("unavailable")) return { level: "unavailable", local };
  if (local) return { level: "local", local };
  return { level: null, local };
}

export const EXPECTED_SECURITY = {
  secure: ["secure"],
  insecure: ["insecure"],
  mixed: ["mixed"],
  certificateError: ["certificateError"],
  internal: ["local"],
};

export function securityVerdict(kind, text) {
  const seen = classifySitePanel(text);
  const expected = EXPECTED_SECURITY[kind];
  const webPage = kind !== "internal";
  const problems = [];
  if (!seen.level) problems.push("the site panel showed no connection row");
  else if (!expected.includes(seen.level)) problems.push(`expected ${expected.join(" or ")}, saw ${seen.level}`);
  if (webPage && seen.local) problems.push("a web page was described as a local page");
  return { ok: problems.length === 0, seen, problems };
}

export function findVerdict(find, expected) {
  if (!find) return { ok: false, problem: "no find state" };
  if (find.count !== expected) return { ok: false, problem: `expected ${expected} matches, saw ${find.count}` };
  if (!(find.active >= 1 && find.active <= expected)) return { ok: false, problem: `active match ${find.active} is outside 1..${expected}` };
  return { ok: true };
}

export function nextActive(active, count, forward) {
  if (!count) return 0;
  return forward ? (active % count) + 1 : ((active - 2 + count) % count) + 1;
}

const PRIVATE_PROFILE = /^incognito:/;

export function privateLeaks(session) {
  const leaks = [];
  if (!session || typeof session !== "object") return leaks;
  for (const [id, w] of Object.entries(session.windows ?? {})) {
    if (w?.incognito || w?.kind === "private" || PRIVATE_PROFILE.test(String(w?.profileId ?? "")) || w?.originalProfileId) leaks.push(`window ${id}`);
  }
  for (const [id, tab] of Object.entries(session.tabs ?? {})) {
    if (PRIVATE_PROFILE.test(String(tab?.profileId ?? ""))) leaks.push(`tab ${id}`);
  }
  for (const key of ["profiles", "parkedPins", "pinChoices", "pinSync"]) {
    for (const id of Object.keys(session[key] ?? {})) if (PRIVATE_PROFILE.test(id)) leaks.push(`${key}.${id}`);
  }
  for (const id of session.profileOrder ?? []) if (PRIVATE_PROFILE.test(String(id))) leaks.push(`profileOrder ${id}`);
  const ui = session.ui ?? {};
  if (PRIVATE_PROFILE.test(String(ui.lastProfileId ?? session.lastProfileId ?? ""))) leaks.push("lastProfileId");
  return leaks;
}

export function downloadById(downloads, id) {
  return (downloads ?? []).find((d) => d.id === id) ?? null;
}

export function duplicateIds(items) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of items ?? []) {
    if (seen.has(item.id)) dupes.add(item.id);
    seen.add(item.id);
  }
  return [...dupes];
}

export function zoomAgreement({ storeZoom, pageRatio, baseRatio = 1, tolerance = 0.02 }) {
  if (typeof storeZoom !== "number" || typeof pageRatio !== "number") return { ok: false, problem: `missing zoom values ${storeZoom} / ${pageRatio}` };
  const native = pageRatio / baseRatio;
  return Math.abs(native - storeZoom) <= tolerance ? { ok: true, native } : { ok: false, native, problem: `store zoom ${storeZoom} but page scale ${native.toFixed(3)}` };
}

export function percentText(zoom) {
  return `${Math.round(zoom * 100)}%`;
}

export const UNSUPPORTED_SETTINGS = [
  { id: "general.defaultBrowser", text: "Default browser", pane: "General" },
  { id: "general.openAtLogin", text: "Open Ardia at login", pane: "General" },
  { id: "appearance.pageScrollBars", text: "Scroll bars", pane: "Appearance" },
  { id: "advanced.cliControl", text: "Let the ardia command control Ardia", pane: "Advanced" },
  { id: "advanced.cliInstall", text: "The ardia command", pane: "Advanced" },
];

export function visibleUnsupported(textByPane) {
  const shown = [];
  for (const row of UNSUPPORTED_SETTINGS) {
    const text = textByPane[row.pane];
    if (typeof text === "string" && text.split("\n").some((line) => line.trim() === row.text)) shown.push(row.id);
  }
  return shown;
}

export const LAUNCH_STEPS = ["version", "onboarding", "releaseNotes", "defaultBrowserOffer"];

export function launchStepsComplete(steps) {
  return Array.isArray(steps) && LAUNCH_STEPS.every((step) => steps.includes(step));
}

export function launchLockHolders(locks, name = "ardia.linux.app-launch") {
  return (locks?.held ?? []).filter((lock) => lock.name === name).map((lock) => lock.clientId);
}
