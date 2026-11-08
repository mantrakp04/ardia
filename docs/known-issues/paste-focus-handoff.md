# Edit shortcuts right after a focus move

A browser command like ⌘T runs on the JS thread, so for 30–150 ms after the shortcut the old responder still has AppKit's focus. Before the fix, a ⌘V pressed in that window landed in the old page, even when that page was a now-hidden tab. The user then had to press ⌘V again ("sometimes I need to hit ⌘V twice").

## Fixed: ⌘T, ⌘L and ⌘F pressed while a page or docked DevTools is focused
The fix is `FocusHandoff` in packages/shell/ios/FocusHandoff.swift.

**How a handoff runs**
- The command resigns the page's RenderWidgetHostViewCocoa synchronously.
- A gate starts for that window, holds its keys and waits up to 3 s for the JS thread to pick the command up. JS tells native it has (`ackFocusMove`, the first thing `settlingCommandFocus` does, before the command runs), and the deadline then becomes 2 s from that ack, so a JS thread that is busy for a second still gets its claim in. A newer command while the gate is active starts a newer generation with its own 3 s wait for JS to pick it up (the deadline never moves earlier).
- Edit › Cut, Copy, Paste, Paste and Match Style and Select All wait on the newest generation. So do plain keys typed meanwhile, in the order they were pressed.

**Delivery: one path only.** The field that generation's command focuses (the New Tab box, the command bar, Find, or the page a new tab opens on) claims the generation and is verified as first responder. Only then are the waiting actions performed, and only on it.

**Every other ending drops the waiting keys and actions with a beep.** Most of them also end the gate, so keys are no longer held:
- the deadline (3 s without a pickup, 2 s after it);
- a cancel: the command did nothing, or its destination closed before it mounted (the gate ends unless a newer generation is still waiting);
- a click;
- window close or resign-key.

A newer generation drops the waiting keys and actions the same way, but the gate stays active for the new command.

**Where focus goes after an ending.** Only the deadline and a cancel from a command that left the shown tab unchanged give the page that had focus its focus back, and only while the window has no first responder and that page's tab is still the one shown. A click, a window close and a resign-key leave focus where it is: on the clicked control, in another window, or nowhere. A dropped action never goes anywhere else.

**Acks from the page:** edit keys a page passes back are tagged with their window and its key epoch, and stale ones are dropped with a beep.

## Parked (behaves as before)
Codex reviews r1–r8 found these not to be safely fixable inside this scope:
- **⌘1–9, closeTab, the tab switcher and profile switch** as the first command. They can be no-ops (⌘1 on the current tab), and resigning the page would then lose typed keys.
- **Same-tab closes** (closeFind, closeNewTabBar) as the first command.
- **Services and text-system edit commands** (DefaultKeyBinding `paste:`, a Services `insertText:`). They bypass the Edit menu.
- **A chrome field (Find, the address field) as the source.** Nothing is resigned and nothing is gated.
- **A JS thread that doesn't pick the command up within 3 s, or a destination that takes more than 2 s after the pickup.** The waiting keys and edit actions are dropped with a beep. If the old page's tab is still the one shown, it gets its focus back and the next press works. If JS has already switched to the new tab by then, nothing is restored and no fallback field is focused: keys typed before the new tab's field takes focus are lost, and the field takes it once JS catches up.
- **Selection timing.** RN applies a text input's selection in a later UI block than its focus. The claim hops through the UIManager queue first, but a selection queued after that hop can still land after the paste.
