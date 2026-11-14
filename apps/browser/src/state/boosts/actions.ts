import { secureRandomHex } from "../../platform/secureRandom";
import { isIncognitoProfile } from "../browser/model";
import { boostDomain } from "./match";
import { currentBoostsKey, loadBoosts, setBoostList } from "./store";
import type { Boost } from "./types";
import { withinSourceLimit } from "./valid";

type Patch = Partial<Omit<Boost, "id" | "modified">>;

const blank = (domain: string): Boost => ({
  id: secureRandomHex(32),
  name: domain,
  author: "",
  domain,
  subdomains: false,
  enabled: true,
  colors: null,
  font: null,
  size: 100,
  textCase: "none",
  zaps: [],
  css: "",
  js: "",
  modified: Date.now(),
});

function edit(profileId: string, change: (boosts: Boost[]) => Boost[]) {
  if (isIncognitoProfile(profileId)) return;
  const key = currentBoostsKey(profileId);
  const boosts = loadBoosts(key);
  const next = change(boosts);
  if (next !== boosts) setBoostList(key, next);
}

const editOne = (profileId: string, id: string, change: (boost: Boost) => Boost) =>
  edit(profileId, (boosts) => (boosts.some((b) => b.id === id) ? boosts.map((b) => (b.id === id ? change(b) : b)) : boosts));

const add = (profileId: string, boost: Boost): Boost => {
  edit(profileId, (boosts) => [...boosts, boost]);
  return boost;
};

export const createBoost = (profileId: string, host: string): Boost => add(profileId, blank(boostDomain(host)));

export const updateBoost = (profileId: string, id: string, patch: Patch) =>
  editOne(profileId, id, (boost) => {
    const next = { ...boost, ...patch, modified: Date.now() };
    return withinSourceLimit(next) ? next : boost;
  });

export const deleteBoost = (profileId: string, id: string) => edit(profileId, (boosts) => (boosts.some((b) => b.id === id) ? boosts.filter((b) => b.id !== id) : boosts));

export const setBoostEnabled = (profileId: string, id: string, enabled: boolean) => updateBoost(profileId, id, { enabled });

export const resetBoost = (profileId: string, id: string) =>
  updateBoost(profileId, id, { colors: null, font: null, size: 100, textCase: "none", zaps: [], css: "", js: "" });

export function importBoost(profileId: string, host: string | null, boost: Boost): Boost {
  const domain = host ? boostDomain(host) : boost.domain;
  return add(profileId, { ...boost, id: secureRandomHex(32), domain, enabled: true, js: "", modified: Date.now() });
}
