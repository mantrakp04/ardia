import { pages } from "@ardia/phone-native";
import { useEffect, useState } from "react";
import App from "../App";
import { PageLab } from "./PageLab";

const LAUNCH_POLL_MILLIS = 50;
const LAUNCH_POLL_LIMIT = 60;

export function LaunchRoot() {
  const [mode, setMode] = useState<"pending" | "app" | "lab">("pending");
  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(() => {
      const options = pages.launchOptions();
      attempts += 1;
      if (options === null && attempts < LAUNCH_POLL_LIMIT) return;
      clearInterval(timer);
      setMode(options?.pageLab ? "lab" : "app");
    }, LAUNCH_POLL_MILLIS);
    return () => clearInterval(timer);
  }, []);
  if (mode === "pending") return null;
  return mode === "lab" ? <PageLab /> : <App />;
}
