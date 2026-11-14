import { requireNativeViewManager, type EventSubscription } from "expo-modules-core";
import type { ViewProps } from "react-native";

export type RecordingResult = {
  path: string;
  seconds: number;
  frames: number;
  skipped: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
  includePages: boolean;
  renderMsMean: number;
  renderMsP95: number;
  cpuPercent: number;
  footprintStartMB: number;
  footprintPeakMB: number;
  windows?: { kind: "pictureInPicture" | "chrome" | "app"; frames: number }[];
  withheldWindows?: number;
  maskedPages?: number;
  windowPictureMisses?: number;
  webKitMediaWithheld?: number;
};

export type UploadReply = { status: number; body: string; error?: string | null };

export type ReportEvent =
  | { type: "tick"; seconds: number }
  | { type: "stopped"; result: RecordingResult | null }
  | { type: "upload"; id: string; sent: number; total: number };

export type ReportNative = {
  draftDirectory(): string;
  fileSize(path: string): number;
  removeFile(path: string): void;
  startRecording(windowId: string, includePages: boolean, path: string, maxSeconds: number | null, fps?: number | null, maxPixelWidth?: number | null): Promise<boolean>;
  stopRecording(): Promise<boolean>;
  cancelRecording(): Promise<void>;
  isRecording(): boolean;
  recordingThumbnail(path: string, out: string): Promise<boolean>;
  gzipFile(source: string, destination: string, removeSource: boolean): Promise<number>;
  gzipText(text: string, destination: string): Promise<number>;
  upload(id: string, url: string, method: string, headers: Record<string, string>, path: string): Promise<UploadReply>;
  cancelUploads(): void;
  addListener(name: "onReport", listener: (e: ReportEvent) => void): EventSubscription;
};

export type ReportVideoProps = ViewProps & { path: string | null; playing: boolean };

export const ReportVideo = requireNativeViewManager<ReportVideoProps>("ArdiaReport");
