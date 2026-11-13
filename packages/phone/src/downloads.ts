import { requireNativeModule } from "expo-modules-core";
import type { DownloadEvent, DownloadProgress, Subscription } from "./pageTypes";

type DownloadsNative = {
  addListener(eventName: "onDownloadEvent", listener: (event: DownloadEvent) => void): Subscription;
  active(): Promise<DownloadProgress[]>;
  cancel(id: string): Promise<void>;
  open(uri: string): Promise<boolean>;
};

let loaded: DownloadsNative | undefined;
const native = () => (loaded ??= requireNativeModule<DownloadsNative>("ArdiaDownloads"));

export const downloads = {
  active: () => native().active(),
  cancel: (id: string) => native().cancel(id),
  open: (uri: string) => native().open(uri),
  addListener: (listener: (event: DownloadEvent) => void): Subscription => native().addListener("onDownloadEvent", listener),
};
