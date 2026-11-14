import { call } from "@ardia/ardiacore";

export const saveCaptureImage = (capture: number, folder: string, name: string) => call("webView.saveCapture", { capture, folder, name });
