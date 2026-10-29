import type { EventSubscription } from "expo-modules-core";

export type NotificationPermission = "granted" | "denied" | "notDetermined" | "provisional";

export type NotificationOptions = {
  id?: string;
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  icon?: string;
  tabId?: string;
  windowId?: string;
  origin?: string;
  dismissible?: boolean;
  data?: Record<string, unknown>;
};

export type NotificationResponse = {
  id: string;
  action: "click" | "close";
  tabId: string | null;
  windowId: string | null;
  data: unknown;
};

export type NotificationsNative = {
  addListener(name: "onNotificationResponse", listener: (e: NotificationResponse) => void): EventSubscription;
  notificationPermission(): Promise<NotificationPermission>;
  requestNotificationPermission(): Promise<boolean>;
  postNotification(options: NotificationOptions): Promise<string | null>;
  removeNotifications(ids: string[]): Promise<void>;
  openNotificationSettings(): Promise<void>;
};
