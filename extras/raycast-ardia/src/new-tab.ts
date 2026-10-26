import { closeMainWindow, type LaunchProps } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { newTab } from "./ardia";

export default async function Command(props: LaunchProps<{ arguments: { query?: string } }>) {
  try {
    await closeMainWindow();
    await newTab(props.arguments.query || props.fallbackText || "");
  } catch (e) {
    await showFailureToast(e, { title: "Couldn't open a new tab" });
  }
}
