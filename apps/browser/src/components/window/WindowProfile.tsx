import { WindowProfile as NativeWindowProfile } from "../ui";
import { useWindowId } from "../../state/browser/hooks";
import { useNativeWindowProfile } from "../../state/windows/hooks";

export function WindowProfile() {
  const windowId = useWindowId();
  const [profile, neighbours, selection] = useNativeWindowProfile(windowId);
  return <NativeWindowProfile profile={profile} selection={selection} neighbours={JSON.parse(neighbours) as string[]} style={{ position: "absolute", width: 0, height: 0 }} />;
}
