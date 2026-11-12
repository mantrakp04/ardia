import type { ProviderSection, SearchScope } from "@ardia/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveProviders } from "../../state/omnibox/activeProviders";
import type { ActiveProvider } from "../../state/omnibox/configProviders";
import { createProviderQueries } from "../../state/omnibox/providerQueries";

const NO_SECTIONS: readonly ProviderSection[] = [];
const NO_PROVIDERS: readonly ActiveProvider[] = [];

type Answered = { query: string; targets: readonly ActiveProvider[]; sections: readonly ProviderSection[] };

export function useProviderSections({
  text,
  active,
  scope,
  windowId,
  skip,
}: {
  text: string;
  active: boolean;
  scope: SearchScope | null;
  windowId: string;
  skip: boolean;
}): readonly ProviderSection[] {
  const providers = useActiveProviders(windowId);
  const query = text.trim();
  const targets = useMemo(() => {
    if (!active) return NO_PROVIDERS;
    if (scope?.kind === "provider") return providers.filter((p) => p.id === scope.providerId);
    if (scope || skip || !query || query.startsWith("?")) return NO_PROVIDERS;
    return providers.filter((p) => !p.keyword);
  }, [active, scope, skip, query, providers]);

  const [answered, setAnswered] = useState<Answered>({ query: "", targets: NO_PROVIDERS, sections: NO_SECTIONS });
  const [queries] = useState(createProviderQueries);
  const order = useRef(targets);
  order.current = targets;

  useEffect(() => {
    if (!targets.length) return queries.cancel();
    queries.run(query, targets, (section) =>
      setAnswered((prev) => {
        const kept = prev.query === query && prev.targets === targets ? prev.sections.filter((s) => s.id !== section.id) : [];
        const rank = (s: ProviderSection) => order.current.findIndex((p) => p.id === s.id);
        return { query, targets, sections: [...kept, section].sort((a, b) => rank(a) - rank(b)) };
      }),
    );
  }, [query, targets, queries]);
  useEffect(() => () => queries.cancel(), [queries]);

  return answered.query === query && answered.targets === targets ? answered.sections : NO_SECTIONS;
}
