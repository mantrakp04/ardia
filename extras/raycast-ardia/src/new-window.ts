import { closeMainWindow, type LaunchProps } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { newWindow, profileIdNamed } from "./ardia";

export default async function Command(props: LaunchProps<{ arguments: { profile?: string } }>) {
  const name = props.arguments.profile?.trim();
  try {
    await closeMainWindow();
    await newWindow({ profileId: name ? await profileIdNamed(name) : undefined });
  } catch (e) {
    await showFailureToast(e, { title: "Couldn't open a new window" });
  }
}
