import { AppState } from "react-native";
import { onWindowEvent } from "../../platform/windows";

let activatedAt = 0;
let watching = false;

const markActivation = () => {
  activatedAt = Date.now();
};

export function watchWindowActivation() {
  if (watching) return;
  watching = true;
  onWindowEvent((e) => e.type === "focus" && markActivation());
  AppState.addEventListener("change", (state) => state === "active" && markActivation());
}

export const windowActivatedAt = () => activatedAt;
