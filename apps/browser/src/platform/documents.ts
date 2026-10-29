import { nativeModule, type BangListReply } from "@ardia/shell";

const Documents = nativeModule("ArdiaDocuments");
const nativeRead = (name: string) => Documents.readDocument(name);
const nativeWrite = (name: string, contents: string) => Documents.writeDocument(name, contents);
const writeDocumentImmediately = (name: string, contents: string) => Documents.writeDocumentImmediately(name, contents);
const nativeSave = (name: string, contents: string) => Documents.saveDocument(name, contents);
const nativeRemove = (name: string) => Documents.removeDocument(name);
import { upgradeWorkspaceDocuments } from "../lib/workspaceUpgrade";

export const fetchBangList = (etag: string | null): Promise<BangListReply> => nativeModule("ArdiaShell").fetchBangList(etag);

let checked = false;
let failure: string | null = null;

function ensureWorkspace() {
  if (!checked) {
    checked = true;
    try { upgradeWorkspaceDocuments({ read: nativeRead, write: writeDocumentImmediately }); }
    catch (error) { failure = String(error instanceof Error ? error.message : error); }
  }
  if (failure) throw new Error(failure);
}

export const workspaceUpgradeError = () => failure;
export function readDocument(name: string) { ensureWorkspace(); return nativeRead(name); }
export function writeDocument(name: string, contents: string) { ensureWorkspace(); nativeWrite(name, contents); }

export function saveDocument(name: string, contents: string) { ensureWorkspace(); return nativeSave(name, contents); }
export function removeDocument(name: string) { ensureWorkspace(); return nativeRemove(name); }
