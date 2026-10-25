import { PRODUCT } from "../../lib/productName";

export const ONBOARDING_COPY = {
  wordmark: PRODUCT,
  sourceSubtitle: `${PRODUCT} sets itself up the way you're used to. Change anything later.`,
  quit: {
    subtitle: `What ${PRODUCT} opens to.`,
    startsFresh: `${PRODUCT} starts fresh each launch`,
  },
  system: {
    title: `Make ${PRODUCT} your default?`,
    isDefault: `${PRODUCT} is your default browser`,
    setDefault: `Set ${PRODUCT} as default browser`,
    alreadyDefault: `${PRODUCT} is already your default browser`,
    openByDefault: `Open links and web pages in ${PRODUCT}`,
    dock: `Add ${PRODUCT} to Dock`,
    login: `Open ${PRODUCT} at login`,
  },
  links: {
    little: `Little ${PRODUCT}`,
    littlePicked: `Links from other apps open in Little ${PRODUCT}`,
  },
  pinnedSubtitle: `Pin the apps you use most. They stay put when you open ${PRODUCT}.`,
} as const;
