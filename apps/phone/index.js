import { registerRootComponent } from "expo";
import { Platform } from "react-native";
import App from "./src/App";
import { LaunchRoot } from "./src/dev/LaunchRoot";

registerRootComponent(Platform.OS === "android" ? LaunchRoot : App);
