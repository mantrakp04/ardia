# Edit shortcuts right after a focus move

A browser command like ⌘T runs on the JS thread, so for 30–150 ms after the shortcut the old responder still has AppKit's focus. Before the fix, a ⌘V pressed in that window landed in the old page, even when that page was a now-hidden tab. The user then had to press ⌘V again ("sometimes I need to hit ⌘V twice").

## Fixed: ⌘T, ⌘L and ⌘F pressed while a page or docked DevTools is focused
The fix is `FocusHandoff` in packages/shell/ios/FocusHandoff.swift.

**How a handoff runs**
- The command resigns the page's RenderWidgetHostViewCocoa synchronously.
- A gate opens for that window with a 400 ms lifetime, counted from the first command. A newer command while the gate is open starts a newer generation without extending the deadline.
- Edit › Cut, Copy, Paste, Paste and Match Style and Select All wait on the newest generation.

**Delivery: one path only.** The field that generation's command focuses (the New Tab box, the command bar, Find, or the page a new tab opens on) claims the generation and is verified as first responder. Only then are the waiting actions performed, and only on it.

**Every other ending drops the waiting actions with a beep and opens the gate:**
- the deadline;
- a cancel: the command did nothing, or its destination closed before it mounted;
- a newer generation;
- a click;
- window close or resign-key.

The page that had focus gets it back, but only while its tab is still the one shown. A dropped action never goes anywhere else.

**A key window never stays without a responder.** When the gate ends and the window's first responder is still nil or the window itself, the next UI pass focuses the page that is shown (`ArdiaWebView.focusVisiblePage`), so ⌘A and the arrow keys don't chime and hover keeps reaching the page. The same holds for the other places that resign the page: the lingering New Tab pane (`takeFocusFromLingeringPane`) refocuses the page it hands over to, and `lendPageToSuccessor` asks the holder to take focus back. The hover probe covers what is left: a click on the page while the key window has no responder makes the page under the pointer first responder (`responderLost` heal).

**Acks from the page:** edit keys a page passes back are tagged with their window and its key epoch, and stale ones are dropped with a beep.

## Parked (behaves as before)
Codex reviews r1–r8 found these not to be safely fixable inside this scope:
- **⌘1–9, closeTab, the tab switcher and profile switch** as the first command. They can be no-ops (⌘1 on the current tab), and resigning the page would then lose typed keys.
- **Same-tab closes** (closeFind, closeNewTabBar) as the first command.
- **Services and text-system edit commands** (DefaultKeyBinding `paste:`, a Services `insertText:`). They bypass the Edit menu.
- **A chrome field (Find, the address field) as the source.** Nothing is resigned and nothing is gated.
- **Plain keystrokes typed during the handoff.** A resigned page drops them.
- **Edit actions while the destination is slower than 400 ms** (a very busy JS thread). They're dropped with a beep, and the next press works.
- **Selection timing.** RN applies a text input's selection in a later UI block than its focus. The claim hops through the UIManager queue first, but a selection queued after that hop can still land after the paste.
