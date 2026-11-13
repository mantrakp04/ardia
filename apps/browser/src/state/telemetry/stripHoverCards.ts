let shown = 0;
let otherProfile = 0;

export function noteStripHoverCard(fromOtherProfile: boolean) {
  shown++;
  if (fromOtherProfile) otherProfile++;
}

export function takeStripHoverCardCounts() {
  const taken = { tab_strip_hover_cards: shown, tab_strip_hover_cards_other_profile: otherProfile };
  shown = 0;
  otherProfile = 0;
  return taken;
}
