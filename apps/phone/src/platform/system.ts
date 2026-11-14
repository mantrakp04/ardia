import { getStringAsync, hasStringAsync, setStringAsync } from "expo-clipboard";
import { impactAsync, ImpactFeedbackStyle, notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { getLocales } from "expo-localization";
import { Linking, Share } from "react-native";

export const copyText = (text: string) => setStringAsync(text);

export const shareLink = (url: string, title: string) => Share.share({ message: url, url, title });

export const openExternal = (url: string) => Linking.openURL(url);

export const preferredLanguage = () => getLocales()[0]?.languageCode ?? "en";

export const tapHaptic = () => impactAsync(ImpactFeedbackStyle.Light);

export const pressHaptic = () => impactAsync(ImpactFeedbackStyle.Medium);

export const successHaptic = () => notificationAsync(NotificationFeedbackType.Success);

export const shareText = (text: string, title: string) => Share.share({ message: text, title });

export const pasteText = () => getStringAsync();

export const clipboardHasText = () => hasStringAsync();
