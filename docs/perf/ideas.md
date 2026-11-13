# Speed ideas not taken (yet)

Each one says what it would gain, why it isn't in, and what has to happen first.

## Command bar preconnect and prerender (J4, a page typed often)

Chrome's omnibox learns which typed text leads to which page (AutocompleteActionPredictor) and, once it's confident
about what Enter would open, connects to the site (confidence ≥ 0.3) or prerenders the page (≥ 0.5, never a search), so
Enter shows it at once. We built it (5c9d0422: `ac_omnibox_typed`/`opened`, a 10 s bound on how old a prerendered page
may be) and took it out again: it gained nothing, for two reasons.

- This engine keeps Chrome's "Preload pages" setting off by default (the ungoogled patches set
  `NetworkPredictionOptions::kDefault = kDisabled`), and both preconnect and prerender respect it. Settings › Privacy ›
  Preload pages now turns it on per profile (still off by default).
- With it on, every prerender was cancelled as its page loaded (`PrerenderFinalStatus::kMojoBinderPolicy`): the page
  bound ArdiaCore's page channel, `ardiacore.mojom.ACPageHost`, which Chrome doesn't allow in a prerendered page. That
  cancelled sites' own speculation-rules prerenders too. Now the page doesn't bind the channel while it prerenders:
  its posts are held (in order, at most 64 posts and 2 MiB) and sent on activation, and `PageChannel::Post` drops any
  post from a prerendering frame as a backstop, so nothing a prerendered page says reaches the tab before it's shown.

To take it up again:
1. The owner decides whether Preload pages is on by default. It fetches pages before the user opens them, a privacy
   call, and the reason the ungoogled patches turn it off.
2. (Done: ACPageHost in prerendered pages, see above.)
3. Then measure the trained case (a page opened from the bar 3+ times), with the staleness checks: a page changed
   within the bound shows the prerendered version; past it, the new one; nothing prerenders in another profile.
