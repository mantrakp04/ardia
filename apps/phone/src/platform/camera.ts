import { requireOptionalNativeModule } from "expo-modules-core";
import { Linking } from "react-native";

type CameraPackage = typeof import("expo-camera");

export type CameraAccess = "granted" | "denied" | "undetermined" | "unavailable";

let loaded: CameraPackage | null | undefined;

function cameraPackage(): CameraPackage | null {
  if (loaded === undefined) loaded = requireOptionalNativeModule("ExpoCamera") ? (require("expo-camera") as CameraPackage) : null;
  return loaded;
}

export const canUseCamera = () => cameraPackage() !== null;

const accessOf = (status: string, canAskAgain: boolean): CameraAccess => (status === "granted" ? "granted" : canAskAgain ? "undetermined" : "denied");

export async function cameraAccess(): Promise<CameraAccess> {
  const camera = cameraPackage();
  if (!camera) return "unavailable";
  const permission = await camera.Camera.getCameraPermissionsAsync();
  return accessOf(permission.status, permission.canAskAgain);
}

export async function requestCameraAccess(): Promise<CameraAccess> {
  const camera = cameraPackage();
  if (!camera) return "unavailable";
  const permission = await camera.Camera.requestCameraPermissionsAsync();
  return permission.status === "granted" ? "granted" : "denied";
}

export const openAppSettings = () => Linking.openSettings();
