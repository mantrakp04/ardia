import { scanner } from "@ardia/phone-native";
import { Linking } from "react-native";
import { accessAfterAsking, accessOf, type CameraAccess } from "../lib/cameraAccess";

export type { CameraAccess };

export const canUseCamera = () => scanner.isAvailable();

export const cameraAccess = async (): Promise<CameraAccess> => accessOf(await scanner.permission());

export const requestCameraAccess = async (): Promise<CameraAccess> => accessAfterAsking(await scanner.requestPermission());

export const openAppSettings = () => Linking.openSettings();
