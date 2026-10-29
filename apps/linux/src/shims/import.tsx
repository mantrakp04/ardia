import { ArdiaError } from "@ardia/core";
import * as real from "@ardia-real/import";
import { ardiaHost } from "../host";
import { createHostImport, pendingPasswords } from "../hostImport";
import { setImportPasswordSink } from "../importApply";

export * from "@ardia-real/import";
export { pendingPasswords };

const linux = ardiaHost ? createHostImport(ardiaHost, ArdiaError) : null;
if (linux) setImportPasswordSink({ pending: pendingPasswords, write: linux.writePasswords, discard: linux.discardPasswords });

export const listBrowsers: typeof real.listBrowsers = linux ? linux.listBrowsers : real.listBrowsers;
export const importData: typeof real.importData = linux ? linux.importData : real.importData;
export const unlockBrowser: typeof real.unlockBrowser = linux ? linux.unlockBrowser : real.unlockBrowser;
export const isBrowserUnlocked: typeof real.isBrowserUnlocked = linux ? linux.isBrowserUnlocked : real.isBrowserUnlocked;
export const forgetUnlockedKeys: typeof real.forgetUnlockedKeys = linux ? linux.forgetUnlockedKeys : real.forgetUnlockedKeys;
export const writeImported: typeof real.writeImported = linux ? linux.writeImported : real.writeImported;
export const discardImported: typeof real.discardImported = linux ? linux.discardImported : real.discardImported;
export const listExtensions: typeof real.listExtensions = linux ? linux.listExtensions : real.listExtensions;
export const importSafariExport: typeof real.importSafariExport = linux ? linux.importSafariExport : real.importSafariExport;
export const safariHasFullDiskAccess: typeof real.safariHasFullDiskAccess = linux ? linux.safariHasFullDiskAccess : real.safariHasFullDiskAccess;
export const openFullDiskAccessSettings: typeof real.openFullDiskAccessSettings = linux ? linux.openFullDiskAccessSettings : real.openFullDiskAccessSettings;
export const importSafariDirect: typeof real.importSafariDirect = linux ? linux.importSafariDirect : real.importSafariDirect;
export const importBookmarksHTML: typeof real.importBookmarksHTML = linux ? linux.importBookmarksHTML : real.importBookmarksHTML;
export const importPasswordsCSV: typeof real.importPasswordsCSV = linux ? linux.importPasswordsCSV : real.importPasswordsCSV;
export const chooseImportFile: typeof real.chooseImportFile = linux ? linux.chooseImportFile : real.chooseImportFile;
export const readDiaTabs: typeof real.readDiaTabs = linux ? linux.readDiaTabs : real.readDiaTabs;

export const writeImportedPasswords = (token: string, profile: string) =>
  linux ? linux.writePasswords(token, profile) : Promise.reject(new ArdiaError("unsupported", "Password import needs the Linux host"));

export const discardImportedPasswords = (token: string) => linux?.discardPasswords(token);
