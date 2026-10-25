import { closeMainWindow } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { newWindow } from "./ardia";

export default async function Command() {
  try {
    await closeMainWindow();
    await newWindow({ incognito: true });
  } catch (e) {
    await showFailureToast(e, { title: "Couldn't open an incognito window" });
  }
}
