import type { Plugin } from "vite";
import { hasMacModifiers, linuxShortcutText } from "./shortcutText";

type Wording = { file: string; replacements: [string, string][] };

export const LINUX_WORDING: readonly Wording[] = [
  {
    file: "state/live/engine.ts",
    replacements: [
      [
        "    case \"signedOut\":\n      return `Sign back in to ${name}`;\n",
        "    case \"signedOut\":\n      return `Sign back in to ${name}`;\n    case \"keyringLocked\":\n      return `Unlock your keyring to refresh ${name}`;\n    case \"keyringUnavailable\":\n      return `Start your keyring to refresh ${name}`;\n",
      ],
    ],
  },
  {
    file: "components/onboarding/SourceStep.tsx",
    replacements: [[`<SectionLabel title="Found on this Mac" />`, `<SectionLabel title="Found on this computer" />`]],
  },
  {
    file: "components/onboarding/LookStep.tsx",
    replacements: [[`subtitle: "Light by day, dark by night, like your Mac"`, `subtitle: "Light or dark, following your desktop"`]],
  },
  {
    file: "components/onboarding/previews/MockWindow.tsx",
    replacements: [["{`Auto · ${look.dark ? \"Dark\" : \"Light\"} like your Mac`}", "{`Auto · ${look.dark ? \"Dark\" : \"Light\"} like your desktop`}"]],
  },
  {
    file: "components/onboarding/previews/scenes/LookScenes.tsx",
    replacements: [["`Auto · ${toDark ? \"Dark\" : \"Light\"} like your Mac`", "`Auto · ${toDark ? \"Dark\" : \"Light\"} like your desktop`"]],
  },
  {
    file: "components/settings/panes/Appearance.tsx",
    replacements: [[`{ value: "system", title: "Follow macOS" }`, `{ value: "system", title: "Follow system" }`]],
  },
  {
    file: "components/settings/rows/generalRows.ts",
    replacements: [
      ["description: `Asks before ${APP} quits with ⌘Q.`", "description: `Asks before ${APP} quits with Ctrl+Shift+Q.`"],
      [
        `"Follow macOS uses System Settings › Appearance › Show scroll bars. Thin shows slim scroll bars over the page only while you scroll, even with a mouse."`,
        `"Follow system keeps the scroll bars your desktop shows. Thin shows slim scroll bars over the page only while you scroll, even with a mouse."`,
      ],
    ],
  },
  {
    file: "components/settings/panes/Privacy.tsx",
    replacements: [[`description="Built on EasyList and EasyPrivacy. Blocking happens on this Mac."`, `description="Built on EasyList and EasyPrivacy. Blocking happens on this computer."`]],
  },
  {
    file: "components/settings/rows/privacyRows.ts",
    replacements: [
      [`description: "Every field, and what never leaves this Mac."`, `description: "Every field, and what never leaves this computer."`],
      [`title: "Zoom with ⌘ and the mouse wheel"`, `title: "Zoom with Ctrl and the mouse wheel"`],
    ],
  },
  {
    file: "state/telemetry/copy.ts",
    replacements: [
      ["Sent to ardia.dev with a random ID made on this Mac, and kept", "Sent to ardia.dev with a random ID made on this computer, and kept"],
      ["app version, update channel, macOS version, chip,", "app version, update channel, operating system version, chip,"],
      [
        `dailyCountShort: "Either way, Ardia sends one anonymous “opened today” count a day, with its version and macOS version and no persistent ID."`,
        `dailyCountShort: "Either way, Ardia sends one anonymous “opened today” count a day, with its version and operating system version and no persistent ID."`,
      ],
      [
        "change it any time in Settings › Privacy & Security. Either way, Ardia sends one anonymous “opened today” count a day, with its version and macOS version and no persistent ID.",
        "change it any time in Settings › Privacy & Security. Either way, Ardia sends one anonymous “opened today” count a day, with its version and operating system version and no persistent ID.",
      ],
      ["A random install ID, made on this Mac (", "A random install ID, made on this computer ("],
      ["App version and build, macOS version, chip", "App version and build, operating system version, chip"],
      ["whether it's the first launch since the Mac started", "whether it's the first launch since the computer started"],
    ],
  },
  {
    file: "components/import/steps/ChooseStep.tsx",
    replacements: [["No other browsers with data to import were found on this Mac.", "No other browsers with data to import were found on this computer."]],
  },
  {
    file: "components/import/steps/SafariStep.tsx",
    replacements: [["`macOS protects ${source.name}'s data from other apps. To import", "`${source.name}'s data is protected from other apps. To import"]],
  },
  {
    file: "state/import/runImport.ts",
    replacements: [
      [
        "`macOS didn't allow access to ${source.name}'s keychain item. Try again, or skip the encrypted data.`",
        "`The system keyring didn't allow access to ${source.name}'s Safe Storage key. Try again, or skip the encrypted data.`",
      ],
      [
        "`${NOT_BROUGHT} macOS didn't allow Ardia to ask Dia for them. Allow it in System Settings › Privacy & Security › Automation, then import again.`",
        "`${NOT_BROUGHT} Ardia wasn't allowed to ask Dia for them.`",
      ],
    ],
  },
  {
    file: "state/extensions/actions.ts",
    replacements: [[`"The extension's folder stays on your Mac."`, `"The extension's folder stays on this computer."`]],
  },
];

const marker = "/apps/browser/src/";
const sharedPath = (id: string) => {
  const at = id.indexOf(marker);
  return at < 0 ? null : (id.slice(at + marker.length).split("?")[0] ?? "");
};

export function rewordForLinux(id: string, code: string): string | null {
  const path = sharedPath(id);
  const wording = path === null ? undefined : LINUX_WORDING.find((entry) => entry.file === path);
  if (!wording) return null;
  let reworded = code;
  for (const [from, to] of wording.replacements) {
    const found = reworded.includes(from) ? from : hasMacModifiers(from) && reworded.includes(linuxShortcutText(from)) ? linuxShortcutText(from) : null;
    if (found === null) throw new Error(`${path} no longer contains ${JSON.stringify(from.slice(0, 80))}; update apps/linux/linuxWording.ts`);
    reworded = reworded.replace(found, () => to);
  }
  return reworded;
}

const sharesWording = (path: string) => /^components\/(settings|import|onboarding)\//.test(path);

export function linuxWording(): Plugin {
  const applied = new Set<string>();
  let building = false;
  return {
    name: "ardia-linux:wording",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    transform(code, id) {
      const reworded = rewordForLinux(id, code);
      if (reworded === null) return null;
      applied.add(sharedPath(id) ?? "");
      return { code: reworded, map: null };
    },
    buildEnd(error) {
      if (!building || error) return;
      const loaded = [...this.getModuleIds()].map(sharedPath).filter((path): path is string => path !== null);
      if (!loaded.some(sharesWording)) return;
      const missing = LINUX_WORDING.map((entry) => entry.file).filter((file) => !applied.has(file));
      if (missing.length) this.error(`linuxWording.ts never reworded ${missing.join(", ")}; update apps/linux/linuxWording.ts`);
    },
  };
}
