import { nativeModule, type NotificationOptions, type NotificationResponse } from "@ardia/shell";

export type { NotificationResponse };

const Notifications = nativeModule("ArdiaNotifications");

export const notificationPermission = () => Notifications.notificationPermission();
export const requestNotificationPermission = () => Notifications.requestNotificationPermission();
export const postNotification = (options: NotificationOptions) => Notifications.postNotification(options);
export const removeNotifications = (ids: string[]) => Notifications.removeNotifications(ids);
export const openNotificationSettings = () => Notifications.openNotificationSettings();
export const onNotificationResponse = (listener: (e: NotificationResponse) => void) => Notifications.addListener("onNotificationResponse", listener);
