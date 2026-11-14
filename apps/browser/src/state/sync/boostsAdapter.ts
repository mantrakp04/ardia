import { canonical, type Adapter } from "../../platform/sync";
import { loadBoosts, setBoostList } from "../boosts/store";
import { validBoost, withoutId } from "../boosts/valid";
import { BOOST } from "./records";

export function boostsAdapter(profileId: string): Adapter {
  return {
    prefix: BOOST,
    extract: () => ({ values: new Map(loadBoosts(profileId).map((boost) => [`${BOOST}${boost.id}`, withoutId(boost)])) }),
    apply: (visible, changed) => {
      const current = loadBoosts(profileId);
      let next = current;
      for (const key of changed) {
        const id = key.slice(BOOST.length);
        if (!id) continue;
        const remote = visible.has(key) ? validBoost(id, visible.get(key)) : null;
        const local = next.find((b) => b.id === id);
        if (!remote) {
          if (!visible.has(key) && local) next = next.filter((b) => b.id !== id);
        } else if (!local) {
          next = [...next, remote];
        } else if (canonical(withoutId(local)) !== canonical(withoutId(remote))) {
          next = next.map((b) => (b.id === id ? remote : b));
        }
      }
      if (next !== current) setBoostList(profileId, [...next].sort((a, b) => (a.id < b.id ? -1 : 1)));
    },
  };
}
