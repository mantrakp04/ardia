import { setButtonStyleAsync } from "expo-navigation-bar";
import { Platform, StatusBar } from "react-native";

export function setSystemBarIcons(lightStatus: boolean, lightNavigation: boolean) {
  StatusBar.setBarStyle(lightStatus ? "light-content" : "dark-content", true);
  if (Platform.OS === "android") void setButtonStyleAsync(lightNavigation ? "light" : "dark").catch(() => undefined);
}
