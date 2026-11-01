import { ensureNotificationPermission as ensureSharedNotificationPermission } from "../../browser/src/state/site/webNotifications";

export * from "../../browser/src/state/site/webNotifications";

export function ensureNotificationPermission(...args: Parameters<typeof ensureSharedNotificationPermission>): Promise<boolean> {
  return ensureSharedNotificationPermission(...args).catch((error: { code?: unknown } | null) => {
    if (error?.code === "ERR_UNAVAILABLE") return false;
    throw error;
  });
}
