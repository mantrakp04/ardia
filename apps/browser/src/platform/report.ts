import { nativeModule, type RecordingResult, type ReportEvent, type UploadReply } from "@ardia/shell";

export type { RecordingResult, ReportEvent, UploadReply };

let bound: ReturnType<typeof nativeModule<"ArdiaReport">> | null = null;
const Report = () => (bound ??= nativeModule("ArdiaReport"));

export const draftDirectory = () => Report().draftDirectory();
export const fileSize = (path: string) => Report().fileSize(path);
export const removeReportFile = (path: string) => Report().removeFile(path);
export const startWindowRecording = (windowId: string, includePages: boolean, path: string, maxSeconds: number, fps: number | null = null, maxPixelWidth: number | null = null) =>
  Report().startRecording(windowId, includePages, path, maxSeconds, fps, maxPixelWidth);
export const stopWindowRecording = () => Report().stopRecording();
export const cancelWindowRecording = () => Report().cancelRecording();
export const recordingThumbnail = (path: string, out: string) => Report().recordingThumbnail(path, out);
export const gzipFile = (source: string, destination: string, removeSource: boolean) => Report().gzipFile(source, destination, removeSource);
export const gzipText = (text: string, destination: string) => Report().gzipText(text, destination);
export const uploadFile = (id: string, url: string, method: string, headers: Record<string, string>, path: string) =>
  Report().upload(id, url, method, headers, path);
export const cancelUploads = () => Report().cancelUploads();
export const onReportEvent = (listener: (event: ReportEvent) => void) => Report().addListener("onReport", listener);
