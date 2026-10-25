import { getPrivacySettings, setPrivacySetting, onContentBlockerChange, type PrivacySettings, type PrivacySettingKey } from "@ardia/ardiacore";
import { useEffect, useRef, useState } from "react";

export function usePrivacySettings(profile: string, origin = "", pollMs = 0) {
  const [state, setState] = useState<PrivacySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = async (version = generation.current) => {
    try {
      const value = await getPrivacySettings(profile, origin);
      if (version === generation.current) { setState(value); setError(""); }
    } catch (e) {
      if (version === generation.current) { setState(null); setError(e instanceof Error ? e.message : String(e)); }
    }
  };
  useEffect(() => {
    const version = ++generation.current;
    setState(null);
    setBusy(false);
    setError("");
    void refresh(version);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      await refresh(version);
      if (!stopped) timer = setTimeout(poll, pollMs);
    };
    if (pollMs > 0) timer = setTimeout(poll, pollMs);
    const subscription = onContentBlockerChange(() => void refresh(version));
    return () => { stopped = true; clearTimeout(timer); generation.current++; subscription.remove(); };
  }, [profile, origin, pollMs]);
  const set = async (key: PrivacySettingKey, value: boolean, target = origin) => {
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      await setPrivacySetting(profile, key, value, target);
      await refresh(version);
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  return { state, busy, error, set, refresh };
}
