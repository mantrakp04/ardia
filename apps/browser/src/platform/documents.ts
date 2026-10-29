import { nativeModule, type BangListReply } from "@ardia/shell";

const Documents = nativeModule("ArdiaDocuments");

export const readDocument = (name: string) => Documents.readDocument(name);
export const writeDocument = (name: string, contents: string) => Documents.writeDocument(name, contents);
export const saveDocument = (name: string, contents: string) => Documents.saveDocument(name, contents);
export const removeDocument = (name: string) => Documents.removeDocument(name);
export const fetchBangList = (etag: string | null): Promise<BangListReply> => nativeModule("ArdiaShell").fetchBangList(etag);
