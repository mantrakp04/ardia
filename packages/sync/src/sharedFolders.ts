import { requireOptionalNativeModule } from "expo-modules-core";

export type SharedListingEntry =
  | { kind: "link"; file: string; text: string }
  | { kind: "pending"; file: string; reason: "download" | "unreadable" }
  | { kind: "dir"; file: string; level: SharedListingLevel };

export type SharedListingLevel = { entries: SharedListingEntry[]; manifest: string | null; manifestPending: boolean; error?: string };

export type SharedListing = { exists: false; error?: string } | { exists: true; root: SharedListingLevel };

export type SharedFolderOp =
  | { op: "write"; path: string; text: string; create: boolean; expect: string | null }
  | { op: "move"; path: string; to: string }
  | { op: "delete"; path: string; expect: string }
  | { op: "mkdir"; path: string }
  | { op: "rmdir"; path: string };

export type SharedLocation = { path: string; iCloudAvailable: boolean; iCloudPath: string };

type SharedFoldersNative = {
  location(): SharedLocation;
  read(path: string): Promise<SharedListing>;
  apply(path: string, ops: string): Promise<{ conflicts: string[] }>;
  create(parent: string, name: string): Promise<string>;
  watch(paths: string[]): void;
  addListener(name: "onChange", listener: (event: { paths: string[] }) => void): { remove(): void };
};

export const SharedFoldersNative = requireOptionalNativeModule<SharedFoldersNative>("ArdiaSharedFolders");
