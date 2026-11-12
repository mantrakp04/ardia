import { useMemo } from "react";
import { WindowProfile as NativeWindowProfile } from "../ui";
import { useWindowId } from "../../state/browser/hooks";
import { useNativeWindowProfile } from "../../state/windows/hooks";
import { useOpenedEngines } from "../../state/profiles/profileLoading";
import { noteProfileSwapped } from "../../state/telemetry/profileSwap";

export function WindowProfile() {
  const windowId = useWindowId();
  const [profile, neighbours, selection] = useNativeWindowProfile(windowId);
  const opened = useOpenedEngines(useMemo(() => JSON.parse(neighbours) as string[], [neighbours]));
  return (
    <NativeWindowProfile
      profile={profile}
      selection={selection}
      neighbours={opened}
      onSwapped={(event) => noteProfileSwapped(windowId, event.nativeEvent)}
      style={{ position: "absolute", width: 0, height: 0 }}
    />
  );
}
