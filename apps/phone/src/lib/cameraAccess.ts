export type CameraAccess = "granted" | "denied" | "undetermined" | "unavailable";

export type ScanPermissionLike = { status: "granted" | "denied" | "undetermined" | "unsupported"; canAskAgain: boolean };

export function accessOf(permission: ScanPermissionLike): CameraAccess {
  if (permission.status === "unsupported") return "unavailable";
  if (permission.status === "granted") return "granted";
  if (permission.status === "undetermined") return "undetermined";
  return permission.canAskAgain ? "undetermined" : "denied";
}

export const accessAfterAsking = (permission: ScanPermissionLike): CameraAccess => {
  const access = accessOf(permission);
  return access === "undetermined" ? "denied" : access;
};

export const cameraErrorAccess = (error: "permission" | "unsupported" | "camera"): CameraAccess => (error === "permission" ? "denied" : "unavailable");
