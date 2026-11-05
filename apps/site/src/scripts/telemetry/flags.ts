import { FLAGS, type FlagKey } from "../../data/telemetry";
import { KEYS, readJSON, write } from "../storage";
import { capture, distinctId, enabled, register } from "./core";

const SCALE = 0xfffffffffffffffn;

async function hash(key: string, id: string, salt: string): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${key}.${id}${salt}`));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex.slice(0, 15)}`);
}

async function bucket(key: FlagKey, id: string): Promise<string | null> {
  const flag = FLAGS[key];
  if (flag.rollout < 100 && (await hash(key, id, "")) * 100n > BigInt(flag.rollout) * SCALE) return null;
  const h = (await hash(key, id, "variant")) * 100n;
  let cumulative = 0;
  for (const v of flag.variants) {
    cumulative += v.rollout;
    if (h < BigInt(cumulative) * SCALE) return v.key;
  }
  return null;
}

async function flagVariant(key: FlagKey): Promise<string | null> {
  if (!enabled || !crypto?.subtle) return null;
  try {
    return await bucket(key, distinctId);
  } catch {
    return null;
  }
}

export async function getFeatureFlag(key: FlagKey): Promise<string | null> {
  const variant = await flagVariant(key);
  if (variant === null) return null;
  const reported = readJSON<Record<string, string>>(KEYS.flagsReported) ?? {};
  if (reported[key] !== variant) {
    const flag = FLAGS[key];
    const props = {
      $feature_flag: key,
      $feature_flag_response: variant,
      $feature_flag_id: flag.id,
      $feature_flag_version: flag.version,
      $feature_flag_reason: "Matched condition set 1",
      $feature_flag_has_experiment: flag.experiment,
      $feature_flag_evaluated_at: Date.now(),
      $used_bootstrap_value: false,
      [`$feature/${key}`]: variant,
    };
    capture("$feature_flag_called", props);
    if (flag.experiment) capture("$experiment_exposure", props);
    reported[key] = variant;
    write(KEYS.flagsReported, JSON.stringify(reported));
  }
  return variant;
}

export async function registerFlags() {
  const active: string[] = [];
  const props: Record<string, string> = {};
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    const v = await flagVariant(key);
    if (v === null) continue;
    active.push(key);
    props[`$feature/${key}`] = v;
  }
  const all = { ...props, $active_feature_flags: active };
  register(all);
  write(KEYS.flags, JSON.stringify({ id: distinctId, props: all }));
}
