import { registerRootComponent } from "expo";

if (process.env.EXPO_PUBLIC_ARDIA_LAB === "true") {
  registerRootComponent(require("./src/dev/LaunchRoot").LaunchRoot);
} else {
  registerRootComponent(require("./src/App").default);
}
