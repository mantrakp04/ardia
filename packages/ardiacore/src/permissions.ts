export type PermissionKind =
  | "camera" | "microphone" | "screen" | "location" | "notifications" | "clipboard" | "midi"
  | "multipleDownloads" | "localFonts" | "idleDetection" | "storageAccess" | "windowManagement" | "fileSystem"
  | "keyboardLock" | "pointerLock" | "protectedMedia" | "protocolHandler" | "sensors" | "localNetwork"
  | "vr" | "ar" | "handTracking" | "identityProvider" | "webAppInstallation" | "capturedSurfaceControl"
  | "diskQuota" | "cameraPanTiltZoom";

export type PermissionRequest = { id: string; tabId: string | null; origin: string; permissions: PermissionKind[] };

export type PermissionResult = "accept" | "deny" | "dismiss";

export type ExternalAppRequest = {
  id: string;
  url: string;
  scheme: string;
  origin: string | null;
  app: string | null;
  appPath: string | null;
  icon: string | null;
  title: string;
  message: string | null;
  remember: string | null;
};

export type ExternalAppAllowance = { origin: string; scheme: string; app: string | null; icon: string | null };
