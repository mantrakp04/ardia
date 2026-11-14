import { cameraAccess, canUseCamera, openAppSettings, requestCameraAccess, type CameraAccess } from "../../platform/camera";
import { settled } from "../pages/store";
import { checkPhrase } from "./actions";
import { scanJudge } from "./syncRules";

export type { CameraAccess };

export const canScanCodes = () => {
  try {
    return canUseCamera();
  } catch {
    return false;
  }
};

export async function prepareCamera(): Promise<CameraAccess> {
  const access = await settled(() => cameraAccess(), "unavailable" as CameraAccess);
  if (access !== "undetermined") return access;
  return settled(() => requestCameraAccess(), "denied" as CameraAccess);
}

export const openCameraSettings = () => void settled(() => openAppSettings(), undefined);

export const makeScanJudge = () => scanJudge((payload) => checkPhrase(payload).isValid);
