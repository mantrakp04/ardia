# Shared folders

A shared folder is a pinned sidebar folder bound to a real directory, by default in
`iCloud Drive › Ardia Shared › <folder name>` (`~/Library/Mobile Documents/com~apple~CloudDocs/Ardia Shared`).
Each link is a standard `.webloc` file, so anyone the directory is shared with can open the links from Finder, with or
without Ardia. iCloud Drive carries the directory between people the way it carries any folder: no CloudKit
container, no entitlement, no server. Dropbox, a NAS or any folder that syncs work the same way.

Arc had shared folders; Dia has none, so this is an Ardia extra (`docs/dia-feature-parity.md` › 3).

## What the user sees

- **Share Folder…** on a pinned folder's context menu. A folder that isn't shared yet becomes one: Ardia creates
  `Ardia Shared/<name>` (`<name> 2` if taken), writes its links, then opens the macOS share picker on the directory
  (the same picker as Share for a tab, `SharePicker.swift`, given the directory's `file://` URL), once a sync round
  has written its links; otherwise it says why and opens nothing. For a directory in
  iCloud Drive, macOS offers Collaborate there, which invites any Apple ID. A shared folder's menu also has its
  sync state (disabled row), Show in Finder and Stop Syncing Folder.
- **Add Shared Folder…** in the sidebar's menu (next to New Group and New Live Folder) opens a folder panel on
  `Ardia Shared`; the directory picked (one someone shared with you appears in iCloud Drive once you accept) becomes
  a pinned folder of the current profile, named after the directory.
- With iCloud Drive off (no `~/Library/Mobile Documents/com~apple~CloudDocs`), both explain it and offer Choose
  Folder…, any folder that syncs.
- The header shows a small `person.2.fill` after the name (the chevron's colour, 0.5), `icloud.and.arrow.down`
  while links wait for iCloud to download, and `exclamationmark.icloud` in `destructive` when the directory is
  missing or a write failed (`components/sidebar/SharedFolderMark.tsx`).
- Removing a shared folder from the sidebar (Delete, Close from the menu, ⌃⌘W or the close control, Ungroup, Unpin,
  Move to Bookmarks Bar, Move to Profile) asks first, and
  says the directory stays with every link and with the people it's shared with. It only unbinds; Ardia never
  deletes the directory.
- Shared folders are per profile: the binding is the profile's, so each profile has its own.

## Files

```
Ardia Shared/
  Team Links/
    .ardia-folder.json       {"version":1,"order":["GitHub.webloc","Reading","Docs.webloc"]}
    GitHub.webloc            XML property list: <key>URL</key><string>https://github.com/</string>
    Docs.webloc
    Reading/                 a nested folder is a subdirectory, with its own .ardia-folder.json
      Essay.webloc
```

- A link's file name is its name (`/` and `:` become `-`, leading dots dropped, at most 200 bytes of UTF-8, never
  splitting a character) plus `.webloc`, so a numbered copy stays under APFS's 255 bytes; unique
  case-insensitively in its directory (`Docs 2.webloc`).
- `.ardia-folder.json` holds the order; one from a newer version of Ardia is read as unknown and never overwritten. Files it doesn't list come after the listed ones, in name order (numbers
  sorted as numbers), so a folder made in Finder reads fine and a file dropped in from Finder lands at the end.
- Ardia reads Finder's binary weblocs too (converted to XML natively, parsed in JS).
- Only `http(s)` links are synced. Any other file, a webloc Ardia can't read or whose URL isn't `http(s)`, and an
  iCloud placeholder (`.<name>.webloc.icloud`, or a dataless file whose download status isn't current) is left
  alone: never shown, never deleted, its name stays taken. A placeholder gets `startDownloadingUbiquitousItem`
  and counts toward "Waiting for N links to download".
- Writes go through `NSFileCoordinator`. A new link is written whole in a same-volume temporary directory and moved in
  exclusively (`RENAME_EXCL`): if the name was taken meanwhile (another Mac or profile adding the same name), the
  write is a conflict, not an overwrite. Changing a link replaces it only if its current URL is the one Ardia last saw;
  a delete removes it only if it is still a regular file holding that URL (`unlink`, never a recursive remove), so a
  directory or a changed link put in its place survives. A rename never lands on an existing name (`RENAME_EXCL`), and
  names that swap or change only in case move through a temporary `<name> (moving)` first. A directory is removed
  only once empty (`rmdir`, after its order file and `.DS_Store`).
- Nothing follows a symbolic link: a symlinked file or folder inside the directory is held (never read, written
  through or deleted), and every change is refused unless its real path stays inside the bound directory's.
- Ardia's checks and its changes aren't one atomic step: another process running as the user could swap a checked
  path for a symbolic link, or replace a file between the URL compare and the delete or replace. That needs code
  already running on the unlocked Mac, which `docs/sync.md`'s threat model leaves out. Collaborators only add
  content through iCloud, and what arrives is checked with `lstat` and held. Whether iCloud Drive can deliver a
  collaborator's symbolic link as a real link wasn't tested; if it does, it is held like any other.
- Every link Ardia writes carries an identity in its webloc (an `ArdiaLink` string next to `URL`; Finder and Safari
  ignore it). Identities are resolved across the whole folder first: a link a collaborator moved into another
  subfolder is a move, so its tab follows and keeps local edits, which are then written at the new path. Within a
  folder a link is matched by identity, then file name, then URL. Subfolders are paired with directories once, for
  the whole round and exclusively: by the identities their links share, then by name, then by file names inside.
  Each identity has one owner across the whole folder: the file at the link's own place (its own name first), else
  the first in folder order. Every other copy (a Finder copy keeps the identity, in the same subfolder or another) is
  a new link and gets a fresh identity written in place, on the first bind too. A round writes content and identity changes in place before any rename, so a
  round cut short anywhere (a crash mid-swap) is picked up by the next one with no edit lost and no two links trading
  places. If a round would rename a file that has no identity yet (one made in Finder), it only writes identities
  and saves them in the base; the renames wait for the next round. A batch stops at its first conflict.
- A webloc over 64 KB or an order file over 1 MB is held. Reads are bounded (`O_NOFOLLOW`, `fstat`, at most the cap
  plus one byte). A directory that can't be listed
  (permissions, a NAS hiccup) fails the whole round, which changes nothing, rather than reading as empty.

## Sync

Each shared folder keeps a base: the folder as both sides last agreed, keyed by tab and group (`pinKey`) with the
file each maps to. A round reads the directory, reads the folder from the store, merges three ways, applies the
result to the store, then writes the files that differ (`state/sharedFolders/engine.ts`).

- **Links.** A link's identity is its tab's pin key locally and its file name in the directory. A base entry gone
  from either side is a deletion (a deletion wins over an edit on the other side). A file missing from the
  directory next to a new file with the same URL is a rename, and keeps its tab. A link added on both sides with the
  same URL is one link (that's also how a folder bound again with no base matches up instead of doubling).
- **Names.** A link's name is the tab's custom title, else the name it was last synced with, else its title: once a
  link is synced, page titles and loads never rename its file. A local rename moves the file; a file renamed
  elsewhere sets the tab's custom title. Links created from files carry their file name as their title.
- **URLs.** The link is the tab's pinned URL, not the page it's on, so browsing inside a link never writes. A changed
  pinned URL rewrites the file; a changed file changes the pinned URL (and the page of a sleeping tab).
- **Order.** If the sidebar's order changed since the base, it wins; else the directory's order file does. New links
  slot in after the link they followed on their side; the order file keeps the place of links still downloading.
- **The store.** Links from the directory become sleeping pinned tabs in the folder. A deleted link's tab goes,
  unless its page is open or shown: then it stays as a regular tab outside the folder. A nested folder is a nested
  pinned group. A folder left without links holds an "Empty Folder" row (`about:blank`), as a pinned group can't be
  empty; the first link replaces it. Each change is one store update (`withFolder`), which the pin mirror carries
  to the profile's other windows.
- **Triggers.** FSEvents on every bound directory (0.2 s latency), then 150 ms; a store change to a folder's links,
  names or order (a signature of its links), then 300 ms; every 60 s; and at launch. Rounds of one folder never
  overlap.
- **Where it runs.** On the folder's copy in the profile's front window. While no window shows the profile (its pins
  parked), the folder is paused and catches up when one does. A folder whose group is gone from a shown profile
  is unbound.
- A failed write or a conflict keeps the old base; the next round (3 s later for a conflict) reads the directory
  again, and links already written pair up by URL.
- The base never gets ahead of the saved session: before any file is written or the base saved, the round flushes
  the session and waits until `session.json` has landed on disk (`sessionSaved`, the native `documentSaved`). If it
  hasn't (a snapshot that couldn't even be staged, a failed write, or quitting froze persistence), the round changes
  nothing and tries again 3 s later; persistence keeps an unstaged snapshot dirty and stages it again. Otherwise a crash could leave a
  base naming a tab the session never saved, and the next launch would read that as a deletion.

The binding and base live in `shared-folders.json` in the data folder (`{ version: 1, folders: { <profile>: { <pin
key>: { path, base, addedAt } } } }`). The app isn't sandboxed, so a plain path is enough (no security-scoped
bookmark). Ardia's own sync carries the pinned folder to the owner's other Macs; the binding stays per Mac, so each
Mac adds the shared folder once.

## Code map

| Concern | Where |
| --- | --- |
| Directory read, coordinated writes, placeholders | `packages/sync/ios/Core/SharedFolderDirectory.swift` |
| FSEvents watcher | `packages/sync/ios/SharedFolderWatcher.swift` |
| Expo module `ArdiaSharedFolders` (`location`, `read`, `apply`, `create`, `watch`, event `onChange`) | `packages/sync/ios/SharedFoldersModule.swift`, types in `packages/sync/src/sharedFolders.ts` |
| JS bindings | `apps/browser/src/platform/sharedFolders.ts` |
| Webloc format | `apps/browser/src/lib/webloc.ts` |
| Tree types, file names, order file | `state/sharedFolders/tree.ts` |
| Three-way merge, order | `state/sharedFolders/merge.ts` |
| Identities across the whole folder (moves between subfolders) | `state/sharedFolders/identities.ts` |
| File operations and the next base | `state/sharedFolders/plan.ts` |
| Directory listing → links | `state/sharedFolders/remote.ts` |
| Store → links | `state/sharedFolders/local.ts` |
| Links → store | `state/sharedFolders/applyFolder.ts` |
| Rounds, triggers, where a folder lives | `state/sharedFolders/engine.ts` |
| Bindings and sync state (`shared-folders.json`) | `state/sharedFolders/store.ts` |
| Share Folder…, Add Shared Folder…, the removal confirm | `state/sharedFolders/actions.ts`, `menu.ts`; wired in `state/sidebar/groupMenu.ts` and `sidebarMenu.ts` |
| Header glyph | `components/sidebar/SharedFolderMark.tsx`, `state/sharedFolders/hooks.ts` |
| Share picker for a directory | `packages/shell/ios/SharePicker.swift` (a `file://` URL is shared as itself) |

Tests: `lib/webloc.test.mjs`, `state/sharedFolders/merge.test.mjs` (two Macs over a fake directory: adds, renames,
deletes, order, placeholders, subfolders, convergence, swaps, same-name adds, guarded deletes, unlistable folders),
`applyFolder.test.mjs` (the store side), `engine.test.mjs` (the session is saved before the base) and, for the native
side, `packages/sync/tests/SharedFolderDirectoryTests.swift` (symlinks, guarded deletes, exclusive creates, moves,
unlistable folders, size caps; `swift test --filter SharedFolderDirectoryTests` in `packages/sync`).

## Testing it

`ARDIA_INSTANCE` `sharedFolders=<dir>` sets where shared folders are created and where Add Shared Folder… starts; a
scratch data dir without it uses `<data dir>/Ardia Shared`, so a test instance never writes to the real iCloud
Drive. With `--test appMenu --test appDialog`, menus and confirms take their answers from `menu.json.pick` and
`dialog.json.pick`, and Add Shared Folder…'s panel answers from `file-chooser.txt`; the share picker is logged to
`activation.log` (`share sheet (not shown): url=file:///…`).
