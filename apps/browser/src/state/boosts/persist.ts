import { removeDocument, writeDocument } from "../../platform/documents";
import { setProfileBoosts } from "../../platform/boosts";
import { versionedJson } from "../../lib/savedDocument";
import { orWarn } from "../../lib/fallback";
import { useBrowser } from "../browser/store";
import { engineProfile, isIncognitoProfile } from "../browser/model";
import { compileBoost, fitEngineList, fitsEngine } from "./compile";
import { BOOSTS_VERSION, boostsDocument, boostsKey, loadBoosts, useBoostStore } from "./store";
import type { Boost } from "./types";

const pushed = new Map<string, string>();

const profileKeys = () => {
  const s = useBrowser.getState();
  return [...new Set(Object.keys(s.profiles).filter((id) => !isIncognitoProfile(id)).map((id) => boostsKey(s, id)))];
};

const engineJson = (boosts: Boost[]) => JSON.stringify(fitEngineList(boosts.filter((b) => b.enabled).sort((a, c) => (a.id < c.id ? -1 : 1)).map(compileBoost).filter(fitsEngine)));

function push(key: string, boosts: Boost[]) {
  const engine = engineProfile(useBrowser.getState(), key);
  const json = engineJson(boosts);
  if (json === (pushed.get(engine) ?? "[]")) return;
  pushed.set(engine, json);
  setProfileBoosts(engine, json).catch((error: unknown) => {
    pushed.delete(engine);
    orWarn(undefined)(error);
  });
}

function save(key: string, boosts: Boost[]) {
  try {
    writeDocument(boostsDocument(key), versionedJson({ boosts }, BOOSTS_VERSION));
  } catch (error) {
    console.warn(`[boosts] couldn't save ${boostsDocument(key)}`, error);
  }
}

export function startBoosts() {
  const adopt = () => {
    for (const key of profileKeys()) push(key, loadBoosts(key));
  };
  const stopBoosts = useBoostStore.subscribe((s, prev) => {
    for (const [key, boosts] of Object.entries(s.boostsByProfile)) {
      const before = prev.boostsByProfile[key];
      if (boosts === before) continue;
      push(key, boosts);
      if (before) save(key, boosts);
    }
  });
  const stopProfiles = useBrowser.subscribe((s, prev) => {
    if (s.profiles === prev.profiles) return;
    adopt();
    const kept = new Set(profileKeys());
    const loaded = useBoostStore.getState().boostsByProfile;
    const gone = Object.keys(loaded).filter((key) => !kept.has(key));
    if (!gone.length) return;
    useBoostStore.setState({ boostsByProfile: Object.fromEntries(Object.entries(loaded).filter(([key]) => kept.has(key))) });
    for (const key of gone) removeDocument(boostsDocument(key));
  });
  adopt();
  return () => {
    stopBoosts();
    stopProfiles();
    pushed.clear();
  };
}
