import { nativeModule, type NotificationOptions, type NotificationPostResult, type NotificationResponse } from "@ardia/shell";

export type { NotificationPostResult, NotificationResponse };

const Notifications = nativeModule("ArdiaNotifications");

export const notificationPermission = () => Notifications.notificationPermission();
export const requestNotificationPermission = () => Notifications.requestNotificationPermission();
export const postNotification = (options: NotificationOptions) => Notifications.postNotification(options);
export const removeNotifications = (ids: string[]) => Notifications.removeNotifications(ids);
export const openNotificationSettings = () => Notifications.openNotificationSettings();
export const onNotificationResponse = (listener: (e: NotificationResponse) => void) => Notifications.addListener("onNotificationResponse", listener);
