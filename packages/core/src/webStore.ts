export type ExtensionPermissions = { permissions: string[]; hostPermissions: string[] };

export const isExtensionId = (s: string) => /^[a-p]{32}$/.test(s);

export function webStoreExtensionId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  if (isExtensionId(s)) return s;
  try {
    const url = new URL(s);
    const store =
      url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore/"));
    if (!store) return null;
    const id = url.pathname.split("/").find(isExtensionId);
    return id ?? null;
  } catch {
    return null;
  }
}

export function permissionWarnings(pkg: ExtensionPermissions): string[] {
  const warnings: string[] = [];
  const perms = new Set(pkg.permissions);
  const hosts = pkg.hostPermissions.filter((h) => !/^(chrome|chrome-extension|about|data):/.test(h));
  const allHosts = hosts.some((h) => h === "<all_urls>" || /^(\*|https?|wss?):\/\/\*\//.test(h)) || perms.has("debugger");
  if (allHosts || perms.has("proxy") || perms.has("pageCapture") || perms.has("debugger")) {
    warnings.push("Read and change all your data on all websites");
  } else if (hosts.length) {
    const names = [...new Set(hosts.map(hostLabel).filter(Boolean))] as string[];
    if (names.length === 1) warnings.push(`Read and change your data on ${names[0]}`);
    else if (names.length === 2) warnings.push(`Read and change your data on ${names[0]} and ${names[1]}`);
    else if (names.length === 3) warnings.push(`Read and change your data on ${names[0]}, ${names[1]}, and ${names[2]}`);
    else if (names.length > 3) warnings.push(`Read and change your data on a number of websites`);
  }
  const clipboard = perms.has("clipboardRead") && perms.has("clipboardWrite");
  if (clipboard) warnings.push("Read and modify data you copy and paste");
  for (const [permission, message] of PERMISSION_WARNINGS) {
    if (clipboard && permission.startsWith("clipboard")) continue;
    if (perms.has(permission)) warnings.push(message);
  }
  if (perms.has("declarativeNetRequest") && !allHosts && !perms.has("declarativeNetRequestWithHostAccess"))
    warnings.push("Block content on any page");
  const browsing = perms.has("history") ? "Read and change your browsing history on all your signed-in devices" : null;
  if (!browsing && (perms.has("tabs") || perms.has("webNavigation")) && !allHosts) warnings.push("Read your browsing history");
  if (browsing) warnings.push(browsing);
  return [...new Set(warnings)];
}

function hostLabel(pattern: string): string | null {
  const m = /^[^:]+:\/\/(\*\.)?([^/]+)/.exec(pattern);
  if (!m) return null;
  return m[1] ? `all ${m[2]} sites` : m[2]!;
}

const PERMISSION_WARNINGS: [string, string][] = [
  ["bookmarks", "Read and change your bookmarks"],
  ["clipboardRead", "Read data you copy and paste"],
  ["clipboardWrite", "Modify data you copy and paste"],
  ["contentSettings", "Change your settings that control websites' access to features such as cookies, JavaScript, plugins, geolocation, microphone, camera etc."],
  ["desktopCapture", "Capture content of your screen"],
  ["downloads", "Manage your downloads"],
  ["downloads.open", "Open downloaded files"],
  ["geolocation", "Detect your physical location"],
  ["management", "Manage your apps, extensions, and themes"],
  ["nativeMessaging", "Communicate with cooperating native applications"],
  ["notifications", "Display notifications"],
  ["privacy", "Change your privacy-related settings"],
  ["readingList", "Read and change entries in the reading list"],
  ["sessions", "Read your browsing history on all your signed-in devices"],
  ["system.storage", "Identify and eject storage devices"],
  ["tabCapture", "Capture content of your screen"],
  ["tabGroups", "View and manage your tab groups"],
  ["topSites", "Read a list of your most frequently visited websites"],
  ["ttsEngine", "Read all text spoken using synthesized speech"],
  ["webAuthenticationProxy", "Read and change all your data on all websites"],
];
