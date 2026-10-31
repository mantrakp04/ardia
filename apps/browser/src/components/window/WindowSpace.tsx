import { WindowProfile as NativeWindowProfile } from "../ui";
import { useWindowId } from "../../state/browser/hooks";
import { useNativeWindowProfile } from "../../state/windows/hooks";

export function WindowSpace() {
  const windowId = useWindowId();
  const [space, neighbours, selection] = useNativeWindowProfile(windowId);
  return <NativeWindowProfile profile={space} selection={selection} neighbours={JSON.parse(neighbours) as string[]} style={{ position: "absolute", width: 0, height: 0 }} />;
}
