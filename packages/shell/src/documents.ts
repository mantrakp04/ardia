import { Shell } from "./shellNative";

export const readDocument = (name: string) => Shell.readDocument(name);
export const writeDocument = (name: string, contents: string) => Shell.writeDocument(name, contents);
export const saveDocument = (name: string, contents: string) => Shell.saveDocument(name, contents);
export const removeDocument = (name: string) => Shell.removeDocument(name);

export type BangListReply = { status: number; etag: string | null; contentType: string | null; body: string | null; bytes: number };
export const fetchBangList = (etag: string | null): Promise<BangListReply> => Shell.fetchBangList(etag);
