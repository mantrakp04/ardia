import type { ReportEvent, ShellNativeModules, UploadReply } from "@ardia/shell";
import { nativeEvents } from "./events";

const events = nativeEvents();

export const reportFake = {
  recording: false,
  sizes: new Map<string, number>(),
  removed: [] as string[],
  uploads: [] as { id: string; url: string; method: string; headers: Record<string, string>; path: string }[],
  uploadReply: (_id: string): UploadReply => ({ status: 200, body: "" }),
  emit: (event: ReportEvent) => events.emit("onReport", event),
};

export const reportModule: ShellNativeModules["ArdiaReport"] = {
  draftDirectory: () => "/tmp/report-draft",
  fileSize: (path) => reportFake.sizes.get(path) ?? -1,
  removeFile: (path) => void reportFake.removed.push(path),
  startRecording: async () => (reportFake.recording = true),
  stopRecording: async () => {
    const was = reportFake.recording;
    reportFake.recording = false;
    return was;
  },
  cancelRecording: async () => void (reportFake.recording = false),
  isRecording: () => reportFake.recording,
  recordingThumbnail: async () => false,
  gzipFile: async () => 100,
  gzipText: async (text) => text.length,
  upload: async (id, url, method, headers, path) => {
    reportFake.uploads.push({ id, url, method, headers, path });
    return reportFake.uploadReply(id);
  },
  cancelUploads: () => {},
  addListener: events.addListener,
};
