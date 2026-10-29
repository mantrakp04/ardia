import type { Plugin } from "vite";
import { rewordWith, wordingPlugin, type Wording } from "./credentialWording";

export const SYNC_WORDING: readonly Wording[] = [
  {
    file: "components/settings/panes/Sync.tsx",
    replacements: [
      [
        `extensions and settings across your Macs. It all goes through a folder
        you choose, like one in iCloud Drive, and it’s end-to-end encrypted: only your devices can read it.`,
        `extensions and settings across your computers. It all goes through a folder
        you choose, like one that Syncthing, Nextcloud or Dropbox keeps in sync, and it’s end-to-end encrypted: only your devices can read it.`,
      ],
      [
        `            icon={<Symbol name="exclamationmark.icloud" size={14} color={theme.warning} style={{ width: 28, height: 20 }} />}
            title="iCloud Drive is off on this Mac"
            description="Turn on iCloud Drive in System Settings, or choose another folder that syncs between your Macs, like one in Dropbox, on a NAS or on a USB drive."
          >
            <Button title="Open iCloud Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preferences.AppleIDPrefPane")} />`,
        `            icon={<Symbol name="exclamationmark.triangle.fill" size={13} color={theme.warning} style={{ width: 28, height: 20 }} />}
            title="The default sync folder’s location is missing"
            description="Choose a folder that syncs between your computers, like one that Syncthing, Nextcloud or Dropbox keeps in sync, or one on a NAS or a USB drive."
          >
            <Button title="Choose…" onPress={() => void chooseSyncFolder()} />`,
      ],
      ["No server and no account: your Macs meet in the sync folder.", "No server and no account: your devices meet in the sync folder."],
      [`title: "Show Sync Folder in Finder"`, `title: "Open Sync Folder"`],
      [
        `"Choose which profiles sync on this Mac. Each syncs on its own. Profiles on your other devices can be added to this Mac."`,
        `"Choose which profiles sync on this computer. Each syncs on its own. Profiles on your other devices can be added to this computer."`,
      ],
      [`: "Choose which profiles sync on this Mac. Each syncs on its own."`, `: "Choose which profiles sync on this computer. Each syncs on its own."`],
      ["`${d.name} (This Mac)`", "`${d.name} (This Computer)`"],
      [`title="Just this Mac so far"`, `title="Just this computer so far"`],
    ],
  },
  {
    file: "components/settings/panes/SyncSheets.tsx",
    replacements: [
      ["  useEffect(() => void recoveryKitPreview(168)?.then(setPreview), []);\n", ""],
      [
        `  const more = async () => {
    const choice = await showMenu([
      { id: "copy", title: "Copy", symbol: "doc.on.doc" },
      { id: "share", title: "Share…", symbol: "square.and.arrow.up" },
      { separator: true },
      { id: "text", title: "Save as Text…", symbol: "doc.plaintext" },
    ]);
    if (choice === "copy") await copyRecoveryKit();
    else if (choice === "share") await shareRecoveryKit();
    else if (choice === "text") await save("text");
  };
`,
        "",
      ],
      [
        "<Body>Your Recovery Kit contains all you need to recover your data should you lose access to this device.</Body>",
        "<Body>Your Recovery Kit is a text file with all you need to recover your data should you lose access to this device. It holds your recovery phrase, so keep it private.</Body>",
      ],
      [`Saved to {saved.replace(/^\\/Users\\/[^/]+/, "~")}.`, `Saved to {saved.replace(/^\\/home\\/[^/]+/, "~")}.`],
      [
        `        <View
          accessibilityLabel="Recovery kit preview"
          style={{ width: 168, height: 217, borderRadius: 4, overflow: "hidden", borderWidth: 1, borderColor: theme.groupBorder, backgroundColor: ink.white }}
        >
          {preview ? <Image source={{ uri: preview }} style={{ width: 168, height: 217 }} /> : null}
        </View>
`,
        "",
      ],
      [
        `      <Buttons left={<Button title="Other Options" onPress={() => void more()} />}>
        <Button title="Close" onPress={closeSettingsSheet} />
        <Button title="Save…" kind="primary" onPress={() => void save("pdf")} />`,
        `      <Buttons>
        <Button title="Close" onPress={closeSettingsSheet} />
        <Button title="Save as Text…" kind="primary" onPress={() => void save("text")} />`,
      ],
      [`return "Couldn’t save the sync key in your Keychain.";`, `return "Couldn’t save the sync key in your system keyring.";`],
      [
        `style={{ flex: 1, ...font.body, lineHeight: 18, color: theme.textPrimary, fontFamily: "Menlo" }}`,
        `style={{ flex: 1, ...font.body, lineHeight: 18, color: theme.textPrimary, fontFamily: "monospace" }}`,
      ],
      [
        `On your other Mac, open Ardia › Settings › Sync and choose the same sync folder.`,
        `On your other device, open Ardia › Settings › Sync and choose the same sync folder.`,
      ],
      [
        "Or scan this code with your iPhone’s camera to copy the words, then paste them on your other Mac with Universal Clipboard.",
        "Or scan this code with your phone’s camera to copy the words, then type or paste them on your other device.",
      ],
      [
        `...settingsType.lead, color: theme.textPrimary, fontFamily: "Menlo" }}`,
        `...settingsType.lead, color: theme.textPrimary, fontFamily: "monospace" }}`,
      ],
      [`<Button title="Add to This Mac"`, `<Button title="Add to This Computer"`],
      [
        `"These profiles are on your other devices. Add them to this Mac to sync their pinned tabs, bookmarks, history and passwords here too."`,
        `"These profiles are on your other devices. Add them to this computer to sync their pinned tabs, bookmarks, history and passwords here too."`,
      ],
      [`"Every profile on your other devices is on this Mac too."`, `"Every profile on your other devices is on this computer too."`],
      [`<SheetTitle>This Mac Is Syncing</SheetTitle>`, `<SheetTitle>This Computer Is Syncing</SheetTitle>`],
      ["Recovery Kit. Everything on this Mac stays as it is.", "Recovery Kit. Everything on this computer stays as it is."],
      ["Your data on each Mac stays.", "Your data on each device stays."],
      [
        `  if (folder.inICloud) {
    const rest = folder.path.split("com~apple~CloudDocs")[1]?.split("/").filter(Boolean) ?? [];
    return ["iCloud Drive", ...rest].join(" › ");
  }
  return folder.path.replace(/^\\/Users\\/[^/]+/, "~");`,
        `  return folder.path.replace(/^\\/home\\/[^/]+(?=\\/|$)/, "~");`,
      ],
    ],
  },
  {
    file: "components/settings/rows/generalRows.ts",
    replacements: [
      [
        `description: "Sync your profiles, bookmarks, history, tabs, passwords, extensions and settings across your Macs.", keywords: ["icloud", "recovery phrase",`,
        `description: "Sync your profiles, bookmarks, history, tabs, passwords, extensions and settings across your computers.", keywords: ["syncthing", "recovery phrase",`,
      ],
      [`keywords: ["icloud drive", "dropbox", "folder"]`, `keywords: ["syncthing", "nextcloud", "dropbox", "folder"]`],
    ],
  },
  {
    file: "state/sync/syncDoc.ts",
    replacements: [["Turning sync off never removes them from this Mac.", "Turning sync off never removes them from this computer."]],
  },
  {
    file: "state/sync/engine.ts",
    replacements: [["Enter your recovery phrase to keep syncing on this Mac.", "Enter your recovery phrase to keep syncing on this device."]],
  },
];

export function rewordSync(id: string, code: string): string | null {
  return rewordWith(SYNC_WORDING, "syncWording.ts", id, code);
}

export function syncWording(): Plugin {
  return wordingPlugin("ardia-linux:sync-wording", SYNC_WORDING, "syncWording.ts");
}
