import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";

export const DEFAULT_BROWSER_OFFER = "default-browser-offer.json";

const OFFER_VERSION = 1;
const OFFER_MIGRATIONS: Migrations = { 0: unchanged };

type Offer = { askedAt: number | null };

type OfferOutcome = "none" | "testInstance" | "onboarding" | "alreadyDefault" | "asked";

type OfferDeps = {
  read(name: string): string | null;
  save(name: string, contents: string): Promise<void>;
  testInstance: boolean;
  onboarding: boolean;
  isDefault(): Promise<boolean>;
  setDefault(): Promise<boolean>;
};

export async function offerDefaultBrowserAgain(deps: OfferDeps): Promise<OfferOutcome> {
  let offer: Offer | null = null;
  try {
    offer = parseSaved(deps.read(DEFAULT_BROWSER_OFFER), OFFER_VERSION, OFFER_MIGRATIONS) as Offer | null;
  } catch {}
  if (!offer || offer.askedAt) return "none";
  if (deps.testInstance) return "testInstance";
  const isDefault = deps.onboarding ? false : await deps.isDefault();
  await deps.save(DEFAULT_BROWSER_OFFER, versionedJson({ ...offer, askedAt: Date.now() } satisfies Offer, OFFER_VERSION));
  if (deps.onboarding) return "onboarding";
  if (isDefault) return "alreadyDefault";
  await deps.setDefault();
  return "asked";
}
