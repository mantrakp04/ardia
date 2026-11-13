import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { FolderInfo, SealedLogin, SyncNative } from "@ardia/sync";
import { originalProfile } from "../engine/domains/calling";
import type { DialogsModule, SystemModule, WindowsHostModule, WindowsSyncModule } from "../nativeModuleTypes";
import { base32 } from "./base32";
import { HIDDEN_WORDS, KIT_PDF_NAME, KIT_TEXT_NAME, kitPdf, kitText } from "./kit";
import { base64, grayscalePng } from "./png";
import { qrCode, utf8 } from "./qr";
import { syncVault, type FileCounts } from "./vault";

type SyncContract = NonNullable<typeof SyncNative>;

export const NATIVE_SYNC = "ArdiaWindowsSync";

const FOLDER_NAME = "Ardia Sync";
const QR_SCALE = 8;
const QR_BORDER = 1;

const joinPath = (folder: string, name: string) => `${folder.replace(/[\\/]+$/, "")}\\${name}`;
const sameOrInside = (path: string, root: string) => {
  const a = path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const b = root.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return !!b && (a === b || a.startsWith(`${b}\\`));
};

function qrDataUrl(words: string[]): string {
  const code = qrCode(words.join(" "));
  const side = (code.size + QR_BORDER * 2) * QR_SCALE;
  const shade = (x: number, y: number) => {
    const mx = Math.floor(x / QR_SCALE) - QR_BORDER;
    const my = Math.floor(y / QR_SCALE) - QR_BORDER;
    return mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.dark(mx, my) ? 0 : 255;
  };
  return `data:image/png;base64,${base64(grayscalePng(side, side, shade))}`;
}

export type SyncFileCounts = FileCounts & { hydrated: number };

export function windowsSync(): (SyncContract & { takeFileCounts(): SyncFileCounts }) | null {
  const native = TurboModuleRegistry.get<WindowsSyncModule>(NATIVE_SYNC);
  if (!native) return null;
  const dialogs = () => TurboModuleRegistry.get<TurboModule & DialogsModule>("ArdiaDialogs");
  const system = () => TurboModuleRegistry.get<TurboModule & SystemModule>("ArdiaSystem");
  const host = () => TurboModuleRegistry.get<TurboModule & WindowsHostModule>("ArdiaWindowsHost");
  const constants: ReturnType<WindowsSyncModule["getConstants"]> = native.getConstants?.() ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const oneDrive = text(constants.oneDriveFolder);
  const testFolder = text(constants.testFolder);
  const defaultFolder = testFolder || joinPath(oneDrive || text(constants.documentsFolder), FOLDER_NAME);
  const deviceName = text(constants.computerName) || "This PC";
  const counts: FileCounts = { placeholders: 0, busy: 0 };
  const vault = syncVault(native, counts);

  const kitBytes = (words: string[], format: "pdf" | "text") => (format === "text" ? utf8(kitText(words, new Date(), deviceName)) : kitPdf(words, new Date(), deviceName));

  return {
    async folderInfo(path: string | null): Promise<FolderInfo> {
      const chosen = path ?? defaultFolder;
      const state = await native.folderState(chosen);
      return {
        path: chosen,
        defaultPath: defaultFolder,
        iCloudAvailable: !!testFolder || !!oneDrive,
        inICloud: !!oneDrive && sameOrInside(chosen, oneDrive),
        exists: state.exists,
        writable: state.exists && state.writable,
        hasSyncData: state.exists && state.hasSyncData,
      };
    },
    chooseFolder: async (current) => (await dialogs()?.pickFolder(current, "Use Folder")) ?? null,
    newDeviceId() {
      const hex = host()?.secureRandomHex(16) ?? "";
      if (hex.length !== 32) throw new Error("no random bytes for a device id");
      return base32(new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16))));
    },
    deviceName: () => deviceName,
    createPhrase: (account) => native.createKey(account),
    enterPhrase: (account, phrase, folder) => native.enterPhrase(account, phrase, folder),
    unlock: (account) => native.unlock(account),
    forget: async (account) => void (await native.forget(account)),
    chainStatus: (folder) => vault.chainStatus(folder),
    createChain: (folder) => vault.createChain(folder),
    write: (folder, scope, payload) => vault.write(folder, scope, payload),
    read: (folder, scope, known) => vault.read(folder, scope, known),
    remove: (folder, scope, ids) => vault.remove(folder, scope, ids),
    deleteChain: (folder) => vault.deleteChain(folder),
    sealLocal: (plain) => native.sealLocal(plain),
    openLocal: (sealed) => native.openLocal(sealed),
    recoveryWords: () => native.recoveryWords(),
    async qrCode() {
      const words = await native.recoveryWords();
      return words ? qrDataUrl(words) : null;
    },
    recoveryKitPreview: (width) => native.renderPdf(base64(kitPdf(HIDDEN_WORDS, new Date(), deviceName)), width),
    async saveRecoveryKit(format) {
      const path = await dialogs()?.saveFile(format === "text" ? KIT_TEXT_NAME : KIT_PDF_NAME, format === "text" ? "txt" : "pdf", format === "text" ? "Text" : "PDF", "");
      if (!path) return null;
      const words = await native.recoveryWords();
      if (!words) return null;
      return (await native.saveFile(path, base64(kitBytes(words, format)))) ? path : null;
    },
    async copyRecoveryKit() {
      const words = await native.recoveryWords();
      if (!words) return null;
      return native.copyKitFile(KIT_PDF_NAME, base64(kitBytes(words, "pdf")));
    },
    shareRecoveryKit: async () => false,
    copyRecoveryPhrase: () => native.copyRecoveryPhrase(),
    revealFolder: async (path) => void (await system()?.revealFile(path)),
    async readPasswords(engineProfile): Promise<SealedLogin[] | null> {
      const sealed = await native.readPasswords(originalProfile(engineProfile));
      return sealed === null ? null : (JSON.parse(sealed) as SealedLogin[]);
    },
    savePassword: (engineProfile, origin, username, sealed, replacing) => native.savePassword(originalProfile(engineProfile), origin, username, sealed, replacing),
    takeFileCounts() {
      const taken = { ...counts, hydrated: native.takeHydrated() };
      counts.placeholders = 0;
      counts.busy = 0;
      return taken;
    },
  };
}
