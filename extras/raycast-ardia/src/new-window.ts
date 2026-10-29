import { closeMainWindow, type LaunchProps } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { newWindow, spaceIdNamed } from "./ardia";

export default async function Command(props: LaunchProps<{ arguments: { space?: string } }>) {
  const name = props.arguments.space?.trim();
  try {
    await closeMainWindow();
    await newWindow({ spaceId: name ? await spaceIdNamed(name) : undefined });
  } catch (e) {
    await showFailureToast(e, { title: "Couldn't open a new window" });
  }
}
