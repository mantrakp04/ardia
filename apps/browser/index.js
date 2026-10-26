import "./src/state/telemetry/jsStart";
import "./src/state/app/perfProbe";
import { LogBox } from "react-native";
import { nativeApiSkew } from "./src/platform/nativeApi";
import { startSkewed } from "./src/components/window/NativeApiSkew";

LogBox.ignoreLogs(["The app is running using the Legacy Architecture"]);
LogBox.ignoreAllLogs(true);

if (nativeApiSkew) startSkewed(nativeApiSkew);
else require("./src/main");
