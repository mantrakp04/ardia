import { SharedFoldersNative, SyncNative, type SharedFolderOp } from "@ardia/sync";

export type { SharedFolderOp, SharedListing, SharedListingEntry, SharedListingLevel, SharedLocation } from "@ardia/sync";

const Native = () => SharedFoldersNative!;

export const sharedFoldersAvailable = () => !!SharedFoldersNative;
export const sharedLocation = () => Native().location();
export const readSharedFolder = (path: string) => Native().read(path);
export const writeSharedFolder = (path: string, ops: SharedFolderOp[]) => Native().apply(path, JSON.stringify(ops));
export const createSharedFolder = (parent: string, name: string) => Native().create(parent, name);
export const watchSharedFolders = (paths: string[]) => Native().watch(paths);
export const onSharedFolderChange = (listener: (paths: string[]) => void) => Native().addListener("onChange", (e) => listener(e.paths));
export const revealSharedFolder = (path: string) => SyncNative!.revealFolder(path);
