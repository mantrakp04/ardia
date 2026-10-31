import type { Plugin } from "vite";

export type Wording = { file: string; replacements: [string, string][] };

export const CREDENTIAL_WORDING: readonly Wording[] = [
  {
    file: "components/settings/panes/Passwords.tsx",
    replacements: [
      [
        `  const apps = "1Password, Bitwarden, KeePassXC and Proton Pass extensions connect to their Mac apps.";
  return systemInfo().inApplicationsFolder === false
    ? \`\${apps} For 1Password, move Ardia to your Applications folder and reopen it (1Password only connects to browsers there), then in the 1Password app open Settings › Browser › Add Browser and choose it.\`
    : \`\${apps} For 1Password, add Ardia once: in the 1Password app, open Settings › Browser › Add Browser and choose Ardia.\`;`,
        `  return "Password manager extensions such as 1Password, Bitwarden, KeePassXC and Proton Pass install from the Chrome Web Store. Ardia doesn't set up their connection to a desktop app on Linux yet.";`,
      ],
      [
        `description="Saved on this Mac, separately for each profile, and encrypted with a key in your Keychain."`,
        `description="Saved on this computer, separately for each profile, and encrypted by Chromium with a key from your system keyring when one answers. Storage on this computer, above, names the key in use."`,
      ],
      ["Unlock with Touch ID or your login password to see them.", "Unlock with your system password to see them."],
    ],
  },
  {
    file: "components/settings/panes/Autofill.tsx",
    replacements: [
      ["Card numbers are kept in your macOS Keychain.", "Card numbers are encrypted by Chromium with a key from your system keyring when one answers."],
      [`"Its number is removed from your Keychain too."`, `"Its saved number is deleted too."`],
    ],
  },
  {
    file: "components/settings/rows/privacyRows.ts",
    replacements: [
      [`keywords: ["password manager", "logins", "credentials", "keychain"]`, `keywords: ["password manager", "logins", "credentials", "keyring"]`],
      [`"Filling in or showing a card number asks for Touch ID or your password."`, `"Showing a saved card number asks for your system password."`],
    ],
  },
];

const marker = "/apps/browser/src/";

export function rewordWith(list: readonly Wording[], source: string, id: string, code: string): string | null {
  const at = id.indexOf(marker);
  if (at < 0) return null;
  const path = id.slice(at + marker.length).split("?")[0];
  const wording = list.find((entry) => entry.file === path);
  if (!wording) return null;
  let reworded = code;
  for (const [from, to] of wording.replacements) {
    if (!reworded.includes(from)) throw new Error(`${path} no longer contains ${JSON.stringify(from.slice(0, 80))}; update apps/linux/${source}`);
    reworded = reworded.replace(from, () => to);
  }
  return reworded;
}

export function rewordCredentials(id: string, code: string): string | null {
  return rewordWith(CREDENTIAL_WORDING, "credentialWording.ts", id, code);
}

export function wordingPlugin(name: string, list: readonly Wording[], source: string): Plugin {
  const applied = new Set<string>();
  let building = false;
  return {
    name,
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    transform(code, id) {
      const reworded = rewordWith(list, source, id, code);
      if (reworded === null) return null;
      applied.add(id.slice(id.indexOf(marker) + marker.length).split("?")[0] ?? "");
      return { code: reworded, map: null };
    },
    buildEnd(error) {
      if (!building || error) return;
      const settingsPanes = [...this.getModuleIds()].some((id) => id.includes(`${marker}components/settings/panes/`));
      if (!settingsPanes) return;
      const missing = list.map((entry) => entry.file).filter((file) => !applied.has(file));
      if (missing.length) this.error(`${source} never reworded ${missing.join(", ")}; update apps/linux/${source}`);
    },
  };
}

export function credentialWording(): Plugin {
  return wordingPlugin("ardia-linux:credential-wording", CREDENTIAL_WORDING, "credentialWording.ts");
}
