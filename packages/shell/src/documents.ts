export type BangListReply = { status: number; etag: string | null; contentType: string | null; body: string | null; bytes: number };

export type DocumentsNative = {
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
  saveDocument(name: string, contents: string): Promise<void>;
  removeDocument(name: string): void;
};
