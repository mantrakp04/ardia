# Sync

End-to-end-encrypted sync with no server, no account and no Apple entitlement. Every Mac reads
and writes sealed files in a folder the user picks; any service that syncs a folder carries them
between Macs. The default is `iCloud Drive › Ardia Sync`
(`~/Library/Mobile Documents/com~apple~CloudDocs/Ardia Sync`: iCloud Drive syncs any folder
under it, with no CloudKit container and no entitlement). Dropbox, a NAS or a USB drive work
the same way. A Mac that turned sync on before the rename keeps `Netnyahoo Sync`, and one setting up after it is
offered that folder while it holds the data (`SyncModule.defaultFolder`).

The UX follows Dia's sync (Settings › Account › Sync in Dia 1.50.1; its strings are quoted from
its binary below). Dia's data sits on its servers and devices pair with a 6-character code; here
the folder takes the servers' place and devices pair by entering the recovery phrase.

Code:
- `packages/sync/ios/Core`: plain Swift, also built by `packages/sync/Package.swift`.
  - `RecoveryPhrase.swift`: the phrase (BIP-39).
  - `SyncCrypto.swift`: keys, the file format and names.
  - `SyncVault.swift`: the folder, with file coordination and partial files.
  - `SyncKeyStore.swift`: Keychain.
  - `RecoveryKit.swift`: PDF, text sheet and QR code.
- `packages/sync/ios/SyncModule.swift`: the Expo module (`ArdiaSync`). It also reads this app's saved passwords.
- `packages/sync/src`: the merge, in TypeScript with no dependencies.
  - `scope.ts`: replica, logs, snapshots, compaction.
  - `hlc.ts`: hybrid logical clocks.
  - `order.ts`: fractional positions.
- `apps/browser/src/sync`:
  - `adapters.ts`: store ↔ records.
  - `pinned.ts`: the pinned area (`pin:`, `pinn:`, `pinrow:`, `pord:g:`, `tilefold:`, `pgc:`, `pgh:`). `pinnedAreaAdapters` gives
    its five adapters in the order they have to run: tile folders, rows, the row order, pinned group tabs' homes, then
    the pins.
  - `engine.ts`: state, setup flows, the cycle.
  - `menu.ts`: the overflow menu's synced devices.
- `apps/browser/src/components/settings/panes/Sync.tsx` and `SyncSheets.tsx`: Settings › Sync.

## Threat model

Protected against anyone who can read or write the sync folder but doesn't have the phrase:
Apple, Dropbox, whoever has the NAS or finds the USB drive, malware that reads cloud files.

- They can't read anything. File contents are AES-256-GCM. Folder and file names are keyed
  (HMAC) or random, and say nothing about profiles, sites or data kinds.
- They can't change anything undetected. Every file is authenticated. The associated data binds a
  file to its folder and name, so a file can't be renamed, moved or truncated without failing to
  open. Files that fail are never applied.
- Contents are padded to 1 KiB steps and not compressed. The size of a file says little, and
  attacker-chosen page titles can't be used to probe passwords through compression
  (CRIME-style).

What they do see (metadata): how many profiles sync (one folder each) and how many devices; when
and how much each writes (file count, times, sizes to 1 KiB); and that it's Ardia sync data
(the `NNS1` magic and `.nns` extension).

What they can do: delete or withhold files (denial of service). Withheld files show as
"waiting for N files to download". They can also replay an old file under its own name, which is
harmless: files are immutable, a replayed op merges as a no-op, and an old snapshot can't bring back
a record whose deletion was already applied (see Compaction). They can't forge, reorder
within a file, or move data between profiles.

Not protected against:
- Someone with the phrase. The phrase is the key, like Dia's.
- Someone with the unlocked Mac. They have the data in the clear anyway.
- A compromised Ardia binary.

The phrase's entropy is in each Mac's login Keychain (`Ardia Sync Key`, this device only,
never iCloud Keychain). Losing every Mac and the Recovery Kit loses the synced data. There's no
reset by email, because there's no one to email.

## Recovery phrase and keys

- 24 BIP-39 English words encode 256 bits from `SecRandomCopyBytes` plus an 8-bit checksum (the
  first byte of their SHA-256). The same format as Dia's (its errors: "Recovery phrase must be
  exactly 24 words.", "This recovery phrase is not valid. Please check for typos.", "“%@” is not
  a valid recovery phrase word.").
- Input is lenient: case, punctuation, the kit's numbering ("1. abandon") and 4-letter prefixes
  are all accepted.
- The wordlist is the standard one; a test checks its SHA-256
  (`2f5eed53…dbda`) and Trezor's reference vectors.
- Keys: HKDF-SHA256 over the entropy, salt `netnyahoo-sync/v1`. The magic and the salt keep the app's old name
  for good: every Mac on any version reads the same files (`LegacyName` in `packages/sync/ios/Core/LegacyMigration.swift`).
  - `file-key` (AES-256-GCM) seals every file.
  - `name-key` (HMAC-SHA256) names folders: the chain tag is `HMAC("chain")` and a scope's tag
    is `HMAC("scope/<scope id>")`, each cut to 128 bits and written in base32.
  - The phrase already has 256 bits of entropy, so no password stretching is needed.
- Where the entropy is kept: the login Keychain, as a generic password (`Ardia Sync Key`,
  account = this device's sync id, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not
  synchronizable).
  - Test instances (`ARDIA_DATA_DIR`) keep it in a 0600 file in their data folder instead,
    as Chrome's mock keychain does for them.
  - A Debug build can't read an item an earlier build saved (no prompt, by design). Sync then
    shows "not syncing" with Enter Recovery Phrase…, and the same device carries on.
- The key never crosses to JS. The words do, only for the Recovery Kit and Connect Another Device
  sheets, or when the user types them.
- Every native call that hands out the phrase (Show Words, the QR code, Save, Save as Text, Copy
  and Share of the kit, Copy Words, Copy Recovery Code) first asks macOS for device-owner
  authentication (Touch ID or the login password). A success is good for 60 s, like the
  Passwords pane; Stop Syncing ends it early. Cancelling returns nothing and changes nothing.
  The kit preview in the sheet is drawn with dots instead of the words. Hidden test instances
  never prompt: `ARDIA_TEST=reauth=granted` grants, anything else denies (#241).
- The temporary kit for Copy and Share (`$TMPDIR/Ardia Recovery Kit/`) is deleted at launch.

A wrong phrase is caught in one of two ways. A typo fails the checksum. A valid but different
phrase derives a chain tag that isn't in the folder: "This recovery phrase doesn’t match the
synced data in this folder".

## Folder layout and file format

```
<sync folder>/
  <chain tag>/                 one per phrase (several people can share one folder)
    <scope tag>/               "app" (settings, profiles, devices) or "p:<profile sync id>"
      <file id>.nns            128 random bits, base32
```

A file is `"NNS1" | nonce (12) | AES-GCM ciphertext | tag (16)`.
- AAD: `"NNS1" + "<chain>/<scope>/<file>"`.
- Plaintext: `length (u32 BE) | UTF-8 JSON | zero padding` to the next 1024 bytes.

The JSON is one of:

```jsonc
// A log: a batch of one device's changes. seq counts up per device and scope.
{ "v": 1, "kind": "log", "device": "<id>", "seq": 7, "at": 1790000000000,
  "ops": [{ "k": "bm:<uuid>", "h": "<hlc>", "v": { … } }, { "k": "h:https://…", "h": "…", "v": null }] }
// A snapshot: a device's whole merged replica, and the seqs it covers per device.
{ "v": 1, "kind": "snapshot", "device": "<id>", "at": …, "vv": { "<device>": 41, … },
  "seen": { "<device>": <ms> }, "records": { "<key>": { "h": "<hlc>", "v": …, "o": ["<device>", <seq>] } } }
```

Writing:
- A device only ever creates files, each under a fresh random name, and never changes one. Two
  Macs never write the same file, so the sync service never sees a conflict.
- A file is written whole in a same-volume temporary folder, then moved in inside a coordinated
  write (`NSFileCoordinator`, `.forReplacing`). The sync client never sees half a file under a
  real name.
- A log's seq is never reused. A batch gets its seq and is saved, sealed, to `sync-journal.nns` in
  the app's data folder before it's written (`persist`); a batch whose write fails stays queued
  with its seq. After a crash, `restoreJournal` puts the journalled batches back into the last
  saved state and the next cycle writes them again, byte for byte, before anything new. If the
  first write did land, the folder has the same batch twice, which reads as a no-op on every
  version. The journal is local only (no format change) and is emptied once the saved state
  has its batches. Every journal and state write goes through one queue (`syncFiles.ts`), so a
  state save takes its snapshot, the last part it covers and the clock when its turn comes, and
  removes the parts only after it has landed. Quitting waits for that queue, with the state saved
  last, for up to 3 s before the app answers the quit (`saveBeforeQuit`). From the moment the app starts quitting,
  sync applies nothing (`holdApply`; no pairing or extension installs either, and an apply already waiting on Chrome, an
  extension install or a password save, checks again after each wait and stops, leaving its records unapplied): what a pull brings during the wait
  stays unapplied and the scope doesn't switch to joined, so the saved state never holds a base ahead of the session
  saved when quitting began (tested).

Reading (`SyncVault.read`) handles files that aren't there in full yet:
- iCloud placeholders (`.<id>.nns.icloud` stubs, or dataless files whose
  `ubiquitousItemDownloadingStatus` isn't current) are reported as pending, and
  `startDownloadingUbiquitousItem` is asked for them.
- Files mid-copy (Dropbox, SMB) and empty files fail to open. They're reported as damaged, with
  their age, and retried next cycle; a file that still fails after a day is given up on.
- Everything else is read in a coordinated read.
- Nothing half-arrived is ever applied.

## Merge

Each scope holds a replica: `key → { h: HLC, v: value | null, o: [device, seq] }`.

- **Last writer wins per record** by hybrid logical clock. The HLC is
  `wall(ms, base 36, 9 digits).counter(4).device`, fixed width, so string comparison is clock
  comparison and the device id breaks ties.
- A deletion is a record with `v: null`, a tombstone.
- Merging is a join: commutative, associative and idempotent. Devices converge whatever order
  files arrive in, and a file read twice changes nothing.
- **Clock skew.** A clock never goes below the newest timestamp it has seen, so an edit made
  after seeing another device's edit is newer even if this Mac's clock is behind. Only truly
  concurrent edits are ordered by the (possibly skewed) wall clocks. A Mac whose clock is days
  ahead wins edits concurrent with it, but the next edit anywhere after it syncs wins again (tested).
- **Base, three-way.** Each scope keeps `base`: what the local store held after the last publish
  or apply. A local value different from base is a local edit and becomes an op. A key in base
  but gone locally is a local deletion. Remote changes are applied only over keys with no
  unpublished edits. Each adapter publishes and then applies, with no wait in between, so an
  edit made while files were being read wins and isn't overwritten (tested).
- **Joining.** Local data is published before remote data is applied, so joining is a union: no
  local bookmark, visit or password is lost. Settings and profile names are the exception
  (`adoptRemoteOnJoin`): a joining Mac takes the synced values and doesn't publish its defaults
  until it has read another device's file (`awaitRemote`). Data that existed before sync was
  turned on (passwords, history) is published with its own creation time
  (`Clock.at(editedAt)`), so it doesn't beat a later edit made elsewhere.
- **Version vectors.** `vv[device]` is the highest seq such that every file of that device up to
  it is in the replica. Seqs that arrive out of order wait in `extra` until the gap fills
  (tested).

### Compaction

- **When.** A device writes a snapshot of its replica when a scope has more than 40 files and no
  snapshot has been written in 10 minutes.
- **What it leaves out.** Tombstones older than 45 days are dropped from the snapshot, and so are
  history records older than 90 days.
- **What it removes.** Then it removes, once they're an hour old, the files the snapshot covers:
  logs `(d, s)` with `s ≤ vv[d]`, and snapshots whose `vv` it dominates.
- **Why that's safe.** A snapshot is self-contained, so any device can start from it, and
  concurrent compactions only remove files covered by their own snapshot.
- **Missing logs keep tombstones.** While a replica is missing a log that a later one from the
  same device skipped past (its version vector has a gap), compaction keeps tombstones up to
  90 days instead of 45, since that log could hold an older write that would otherwise come
  back. A log that never shows up holds them for 90 days at most (tested).
- **Known residuals** (each pinned in a test):
  - A log delivered after the hold (45 days, or 90 while this replica sees a gap) can bring a
    deleted record back.
  - A snapshot doesn't carry its writer's gaps, so a Mac that joins from it while a log is still
    missing, and doesn't see a later log of that device itself, holds tombstones 45 days, not 90.
  - A log that never arrives keeps its gap open, and the later logs of its device that the gap
    keeps from being covered stay in the folder.
- **Not done: causal stability.** Dropping a tombstone only once every device has applied it and
  everything written before it would close these, but it's a separate project. An attempt
  (reverted in 7b334d07) showed what it has to get right: stability must count writers whose files
  haven't arrived yet; rebasing a device must not clear the base adapters rely on (the passwords
  adapter then republished an old password over a newer one); a device's incarnation and its
  journal must be saved together, or a restart drops a durable batch; and a restored backup
  must not reuse an incarnation and sequence numbers, or its edits are ignored. It also has to
  run its upkeep in small scopes (under 40 files) and not trust wall clocks for retirement.
- **Collected tombstones.** A device that missed a deletion whose tombstone has since been
  collected still learns of it. Applying a snapshot drops every local record whose origin file
  the snapshot covers but which the snapshot doesn't contain (`ingestSnapshot`). A log a snapshot
  covers is never replayed after it, so a collected deletion can't come back.
- **Old snapshots.** The same holds the other way round. A snapshot record whose origin this
  replica has already applied (its version vector, which is never collected), for a key the
  replica no longer has, is a deletion already applied and is skipped. So a snapshot put back in
  the folder after its tombstones were collected (a replay, a late backup restore) brings nothing
  back (tested). There's no format change. A 0.2.10 Mac still takes such records in, but the
  next snapshot from a newer Mac covers them and leaves them out, which removes them there again.
- **A device offline for weeks.** It reads the newest snapshot and whatever logs came after,
  applies them, and publishes its offline edits (tested). The one gap: an edit made offline to a
  record that was deleted elsewhere, whose tombstone was collected more than 45 days ago, comes
  back as a new record.

### Order

Bookmark folders and the pinned container are ordered by fractional positions (`order.ts`,
base 62, never ending in "0"). A move changes the moved item's position only. Positions are
assigned by keeping the longest increasing run of known positions, so two Macs reordering
different items merge. Equal positions (two inserts in the same place) sort by id and are
separated on the next publish.

## What syncs

Per profile: each synced profile is its own scope, with its own opt-in (Settings › Sync ›
Profiles).
- On joining, Personal pairs with the synced default profile and other profiles pair by name.
  - Pairing waits until the folder shows what to pair with: the synced default profile's record, or other profiles'
    records with nothing left downloading or damaged in the app scope. A Mac that joined while the other Mac hadn't
    written its profiles yet, or while iCloud Drive was still downloading that file, used to pair with what it had
    read so far: Personal got an id of its own, received none of the other Mac's Personal data, and both Macs then
    offered the other's Personal as a new profile (#514). A day after joining it pairs with whatever it has, so a folder
    whose other devices sync no profile doesn't keep it waiting. Until it pairs, no profile is offered to add. Known
    residuals: once the default record is in, other profiles pair by name with what has arrived, even while a file
    with a later profile is still downloading; and a Mac that paired early before this fix keeps its pairing, with two
    default records left in the folder.
- A synced profile this Mac lacks is offered as "Add to This Mac", with "Add All" when there are several.
- Profiles that share another's data (Dia's "Share data with another profile") sync their tabs;
  the shared data syncs with the profile that owns it.
- Which profile's data a profile shares travels as `share:<sync id>` (the owner's sync id), so "Add to This Mac" makes
  it share this Mac's own copy of that owner, adding the owners it leads to first when this Mac lacks them (the whole
  chain is worked out before anything is created). When an owner's `prof:` record hasn't arrived yet, the profile
  waits ("Waiting for the profile it shares data with to sync") rather than getting data of its own. Records from
  different Macs can disagree, even into a cycle; the lowest sync id in a cycle owns the data, so every Mac resolves it
  alike. A profile already here keeps the data it has.
- A profile's sharing is fixed for its life, so `share:` is written once: a Mac publishes it for a profile that shares a
  synced owner's data only while the scope has no record of that key (one a 0.2.38 Mac kept unapplied counts), and
  only after the cycle's own pull of the app scope, and only when that pull left no download and no damaged file
  unresolved (`publishAfterPull`, decided in `fileHealth.ts`; a download stops counting a day after the scope first saw
  it pending, kept as `pendingSince`, and a damaged file is set aside a day after it was first damaged, kept in
  `damaged`, whatever it did in between; a time ahead of the clock counts as now, so a file iCloud never brings down
  can't hold it back for good), so a Mac back on an older saved state sees what's out there first. Such an adapter
  still takes its timestamps in the cycle's first pass, before the pull, so a newer edit from another Mac pulled in
  the same cycle beats an older one held back here (pinned homes rely on it). A sharing profile's `prof:` goes out with its `share:`, in the same batch, so no
  Mac offers it without its sharing. Never as a tombstone, so a deleted profile offered again by "Add to This Mac"
  shares as before, and never over a value this Mac has. Known residual: a value another Mac published that this Mac
  hasn't pulled yet can lose to this Mac's, when a profile's owner starts syncing here mid-session (the cycle's first
  publish runs before its pull); both Macs then keep their own data.
- Limit: a profile that shares the data of an owner deleted on its Mac publishes no `share:`; on other Macs it gets
  data of its own, as before 0.2.39. That data group's bookmarks, history and passwords no longer sync from that Mac
  anyway: only a profile without `dataId` syncs data.

| Key | Scope | What | Notes |
|---|---|---|---|
| `set:<name>` | app | the settings that follow the user (`SYNCED_SETTINGS`: search engine and custom engines, appearance, address bar, tab layout and behaviour, bookmarks bar, full URL, muted sites, clean-up, keyboard shortcuts…) | not window sizes, battery saver, extension engines or the default profile id. A setting this Mac doesn't follow yet (one added in a newer version, received while it ran an older one, which counted it applied) takes the synced value once it does, unless it was chosen on this Mac: each time the saved state loads (an update always relaunches), any synced setting whose value differs from this Mac's and that this Mac never chose goes back to the settings adapter, and waits there while settings sync is off (tested) |
| `prof:<sync id>` | app | a profile's name, colour, icon (`d` for the default) | deleting a profile on one Mac doesn't delete it on another. A `th` field written by development builds of 0.2.40 is read once, as the profile's theme, when it has none |
| `pth:<sync id>` | app | a profile's custom theme `{ t }`, or `{ preset: true }` after going back to a preset colour | its own record, so a rename and a theme change on two Macs both survive, and Macs before 0.2.40, which rebuild `prof:` from what they know, never strip or republish it (tested with a 0.2.38 adapter). Written once a profile has had a custom theme. A profile paired on joining takes the synced theme (or a legacy `th`) before it can publish its own, and a legacy `th` never applies once a `pth:` record is known (tested). A profile paired on joining or added from sync is adopting (`themeAdopting` on its link in `sync.json`, so a restart keeps it): its theme isn't published, with no time limit, until its `pth:` record is applied (also by an older build: a valid `pth:` already in the base ends it when the state loads and after each app-scope sync), a pull with nothing downloading, damaged or given up as bad shows there is none, or the user edits its theme or picks a preset on this Mac. Every change to the flag is made in `syncThemes.ts`, the same as v0.2.43-nightly.4 would (tested against its code). Turning the profile's sync off and on keeps it adopting. Other profiles, and links from before this flag, publish edits at once, whatever else is still downloading; none publishes over a `pth:` record that has arrived but isn't applied yet (tested). Older Macs keep showing the preset colour, which choosing a custom theme doesn't change |
| `share:<sync id>` | app | `{ o }`: the sync id of the profile whose data this one shares | its own key, not a field of `prof:`, so Macs before 0.2.39 keep it untouched instead of republishing `prof:` without it on every cycle; written once, while both sync; never deleted |
| `dev:<device id>` | app | a device's name | removed when it stops syncing |
| `bm:<sync key>` | profile | `{ k, p (parent: its sync key, "bar" or "other"), t, u, a (added), pos }` | Bookmarks are Chrome's (BookmarkModel). A node's sync key is its Chrome UUID, or, for a bookmark synced before 0.2.20, its old id (`bm-…`, kept on Chrome's node as meta info `ac_sync_key`); every Mac makes an old key the node `bookmarkUuidFor` gives it, so Macs on either version name a bookmark alike (no renames, no duplicates; tested). Favicons stay local. A node whose folder was deleted elsewhere lands in Other Bookmarks; a cycle from two concurrent moves is broken the same way on every Mac (tested). Nothing is published or applied until the tree has been read from Chrome |
| `h:<url>` | profile | `{ t, n (visits), vt (last 50 visit times) }` for pages visited in the last 90 days | History is Chrome's (HistoryService). Applying a record adds the visits Chrome lacks; a local edit is a visit the record doesn't have, so Macs settle on the union of their visits (tested). Not deletions: older history (it stays on the Mac that has it and is dropped from snapshots), Chrome's 90-day expiry, URLs past the newest 5,000 the app reads, and pages Chrome doesn't keep (`ardia://`) |
| `tabs:<device id>` | profile | `{ n (device name), tabs: [{ u, t }] }`: that device's 30 most recent open tabs | only its device writes it. It feeds the overflow menu's "Your Devices" |
| `pin:t:<tab id>`, `pin:g:<group id>` | profile | pinned tabs `{ g, u, t, i, ti, pos }` and pinned groups `{ n, i, c, pos }` (Dia's pinned container) | they arrive as unloaded tiles in the window showing the profile and load when selected; when no window shows the profile they join its parked pins. A pinned group's members always live in the group's window, and sync never moves a tab between two open windows: a pin synced into a parked group is parked with it, a parked member joins a group open in a window, a group whose member is open in another window moves to that page's window (the mirror then gives the profile's other windows unloaded copies), and a member open in a third window stays there as a regular tab while the group gets an unloaded copy. A key resolves to the profile's pinned tab or pinned-group member; only when there is none does it fall back to a regular tab that still carries the key (a pin unpinned on this Mac, kept open), preferring one with a page, so another Mac's re-pin takes that page back instead of adding a second tab. A tab sync pins as a tile or row leaves any regular group it was in, as pinning it here would. A member whose pinned group has a tombstone (unpinned or deleted elsewhere) becomes a standalone pin, even if a regular group with that id is still here; one whose group has no record yet (its batch hasn't arrived) shows as a standalone pin meanwhile, its record keeps that group and position while local edits to its other fields (a rename, a new icon) still publish, and it joins the group when the group arrives. A missing group counts as not arrived only when this Mac never had it, has no record of it, and first saw the wait less than 90 days ago, by its own clock (the deadline is saved with the session), as long as a gap holds tombstones (Compaction). Past it the member publishes as a standalone pin, checked on every sync, so an idle Mac gets there too (tested). A tombstone removes only what is still in the pinned container: a group or tab this Mac already kept as regular stays. A pinned group record for a group this Mac keeps as regular (it unpinned it, and another Mac restyled or re-pinned the pinned one) becomes a separate pinned group, so the regular group keeps its name, style and tabs (tested); a member record that names such a group while its pinned group has a tombstone leaves the regular member where it is. One conflict is left: a page change on a member made while another Mac unpins its group can win the member's record. Depending on which Mac syncs first, the member then either follows the unpin, or stays pinned on its own and the unpinning Mac's regular group goes if that was its only tab; both Macs agree and the tab is kept (tested). Settling it needs placement times in the records. Pinning, unpinning into or out of a pinned group, moving a tab between tiles, rows and groups, re-pinning a group or moving a pin to another profile records a pending placement choice (`pinChoices`, like the row choices), so the next sync republishes that record with a fresh timestamp even when its value is unchanged and a later explicit choice outranks an older edit still in transit. A pin's page is published as 0.2.38 does: a member sends the page its copy shows, a tile sends its home URL, both send the copy's title, and applying a record sets the page of a copy that isn't loaded. The copy published is the one in the profile's frontmost window. Known residual: two Macs with the same pin loaded at different pages keep sending their own page on each sync, so the record moves back and forth between them (tested). Nothing is lost, and it stops once either copy unloads or both show the same page. Earlier builds held a page back until it changed locally, but every version of that (a per-copy baseline) let a real navigation go unsent in some case, so it's gone. The group a member waits for and its deadline live in `pinSync`, a side table by profile and pin key saved with the session and pruned like `pinChoices`, so parking, reopening, mirroring and relaunching keep them. Unpinning on one Mac removes the tile on the others. A record's key is matched only to that profile's tabs and groups: when the id is already another profile's tab or group on this Mac (a pin moved between profiles), the pin gets a new local id with the key kept as `pinKey`, so neither profile's records touch the other's pin. A group's `c`, here and in a nested pinned group's `pinn:g:` record, is `null` for Neutral or one of Chrome's nine colours, the values every released version can draw; a group set to None (no background or outline, issue #206) sends `null` there and its None in a `pgc:` record |
| `pinrow:<tab id>` | profile | `1` for a pinned tab shown as a row, `0` for one this Mac chose as a tile | Rows are pinned tabs: their `pin:t:` record is the same as a tile's (order included), so a Mac on a version before rows shows them as tiles, and since it never writes `pinrow:` keys its edits can't turn a row into a tile. A Mac publishes `0` for a tile once it has seen a mark for it. Each tile or row the user chooses there (pins it, or moves it between tiles and rows) is a pending choice kept per profile and pin key (`pinChoices`, saved with the session, so closing windows, parking and mirroring can't lose it); the next sync republishes its mark with a fresh timestamp even when the value is unchanged (unless that mark is already queued in the scope's outbox or journal, or the scope already holds a record whose HLC is not older than the choice's: each choice is stamped with an HLC from the sync clock when it's made (`editClock.ts`, the clock the cycles run on, which has observed every record pulled, unapplied ones included), so a choice made after seeing a record outranks it even when another Mac's clock runs ahead, and once its own publication or a later edit from another Mac is in, a choice restored with an older session is inert and can't be stamped again over that later edit; tested), and drops the choice only once that batch is on disk, so a later choice outranks an older mark still in transit and survives a crash. A pin moved to another profile takes a new choice there, and the source keeps its own while a window there (or the parked set) still has the pin; a choice goes when its pin is unpinned or its profile deleted (also when loading a session, which also raises the generation counter above every loaded choice); a tile it only received publishes nothing, and a mark for a tab it has never had is never deleted. A mark that arrives before its tab is applied when the tab's `pin:t:` record lands, also when that tab is still open there from before an unpin. Unpinning deletes the mark (the rows adapter runs before `pin:`, so it still sees the tab's `pin:t:` record). A mark deleted by a pull (an unpin on another Mac, or a snapshot that left it out) changes nothing here: the `pin:` adapter applies the unpin, so the tab is never turned into a tile first and sent back over the deletion as a local edit (a pinned row deleted on another Mac while this one was away past tombstone retention came back as a tile; tested). A tab unpinned on an older Mac leaves its mark behind, unused unless that tab id is pinned again |
| `tilefold:<tab id>`, `tilefold:n:<folder id>` | profile | `{ f }`: the tile folder a pinned tile is in; `{ n }`: a folder's name | Tiles can sit in a folder tile in Top Apps (2026-10-23). A member's `pin:t:` record is a tile's (order included), so a Mac on a released version shows the folder's tabs as plain tiles side by side and loses none of them; it never writes `tilefold:` keys, so its edits (rename, reorder, close) leave the folder alone, and its unpin takes the tab out of the folder here. Member records carry membership only. A folder's name lives in its `tilefold:n:` record alone, so the newest write wins, by the record's sync timestamp like any record. A Mac writes it only for a name chosen on it (a rename, or a new folder given a name); a name it took from sync, or a folder whose name hasn't arrived yet (it shows as "Folder"), writes nothing, so joining, waiting or tidying can never make an older name look newer. Like `pinrow:`, the folder adapter runs before `pin:`: a mark that arrives before its tab files the tab when its `pin:t:` record lands, a mark for a tab never seen is never deleted, and an unpin deletes the mark, here or on any Mac (a released Mac's unpin leaves a `pin:t:` tombstone, and the mark goes with it). A folder's name record is deleted by the Mac that sees the folder go. A folder left with one tab on any Mac becomes that tile again there, parked pins included, and the deleted marks carry that to the others; a member moved to another profile leaves its folder. Tested against the 0.2.38 adapter, delayed files (concurrent renames, a name arriving after its tabs), a Mac joining and parked pins (state/sync/tileFolders.test.mjs) |
| `pgc:<group key>` | profile | `"none"` while a pinned group (top-level or nested) is set to None | Released top strips look a group's colour up in a table of nine and throw on any other value, so `pin:g:` and `pinn:g:` carry None as `null` (Neutral, which those builds draw, and which since #154 shows no box at rest) and this record says it's None. No released version's prefix starts it, so older Macs keep it unapplied. A group is None here only while its `c` is `null` and this record is live: a colour chosen on an older Mac (a non-null `c`) wins over a stale record, and the next current Mac to sync deletes the record; a rename there sends `null` again and keeps None. The record is deleted when the group here takes any other colour, or when both its group records are deleted; one for a group this Mac doesn't have yet is kept. Its adapter runs before `pin:`, and `pin:` reads it when it applies a group, so a group arriving with its record arrives as None (state/sync/pinned.test.mjs, with the 0.2.40 adapters) |
| `pgh:<pin key>` | profile | the home URL of a tab in a pinned group, as a string (the page it was on when it joined, or the one Replace Pin or Edit Pinned Page set) | Tiles and rows keep their home in `pin:t:`'s `u`; a member's `pin:t:` still sends its current page, as 0.2.38 reads it, so this record carries the home beside it. No released version's prefix starts it (their pin adapter claims every `pin…` key, so it can't be one), so older Macs keep the records unapplied in their replica and snapshots and never delete them. The homes adapter runs before `pin:`: a tab that lands in the same pull as its home gets that home, and one already here is updated, unless its home was changed here since the last sync (that edit is published and wins). A Mac that gets a member before its home takes the page as its home, and publishes a home only over its own last synced one or when the scope has no live record for it, and only after a pull with nothing downloading or damaged this session, so a guess never replaces a home chosen elsewhere that it has seen. A member that leaves its pinned groups here deletes the record, and so does an unpin from any Mac, an older one included (its `pin:t:` tombstone). A deletion pulled from elsewhere changes no tab; the `pin:` adapter decides where the tab goes. Known residual: a home chosen in a Mac's first cycle of a session goes out in the batch after its pin's, and a Mac that has read the pin and not that batch, with no download pending, sends its guess (the pin's page, usually the same URL). Tested with a member arriving with its home, an edit, and the 0.2.40 adapters (state/sync/pinned.test.mjs) |
| `pord:g:<group key>` | profile | `{ a }`: the pin key of the row a top-level pinned group follows in the pinned section, or `null` above every row | Since 0.2.40 rows and pinned groups share one order. The `pin:` records keep the older shape and order (tiles, then rows, then groups, each in the user's order), so Macs on older versions, which sort rows ahead of groups, find nothing to correct and never publish their sorted order back; the interleaving lives only in these records, which they don't read, own or tombstone (no key of theirs starts with `pord`). Applying sorts rows and groups by `pin:` and then puts each group after its row, so an older Mac's reorder among rows or among groups still comes through and the groups follow their rows; a group with no record, or whose row is gone, goes after the last row. Published from the profile's frontmost window, or from its parked pins when no window shows it, and applied to both. A record whose group hasn't arrived yet is kept, and so is one whose row isn't a row here yet: it is never republished while it waits, with no deadline and nothing read from the local clock. The row counts as arrived only as a row (a tile that another Mac turned into a row waits for its `pinrow:` marker), and the wait ends early only on evidence, newer than the order record, that the row stopped being one: its `pin:t:` tombstone, a `pin:t:` record putting it in a group, or a `pinrow:` marker saying it's a tile. Any other change to the row (its title, its icon) and anything older than the order record leave the wait alone. Meanwhile every group whose record names a row this Mac doesn't have goes after the last row, in `pin:` order, so Macs holding the same records show the same order; a group with no record at all keeps the place `pin:` gives it. Only an explicit local choice replaces it: moving a pinned group or row on this Mac (a drag, Move Up/Down, a menu command, pinning or unpinning into a place) marks the groups whose place among the rows changed as chosen (`order:<group>` in `pinChoices`; rows added or removed, sync's own changes and the waiting fallback never do), and the next sync republishes their records with a fresh timestamp and clears the mark. A row deleted for good, whose tombstone was compacted away, leaves its record waiting until someone moves the group. Known and accepted: a Mac that was away past tombstone retention gets that deletion from a snapshot, which leaves no tombstone, so it can't tell the departed row from one still on its way and keeps the group waiting after the last row, so the group can sit in a different place there than on Macs that saw the tombstone, until someone moves it (skipped test in state/sync/adapters.test.mjs). Only the group's own `pin:g:` tombstone removes a record, never not finding it (tested against a pre-0.2.40 adapter, 0.2.38, out-of-order delivery and parked pins) |
| `pw:<origin>\n<username>` | profile | `{ o, u, p }` | see below |
| `ext:<id>`, `ext:v:<id>` | profile | an extension: `{ on, inc, pin }`, or `{ removed: true }` once the user removes it; and the newest version approved anywhere with its permissions, `{ v, fps }` | Chrome Web Store extensions only; see below |

### Extensions

What Chrome Sync does for extensions, through our folder (`packages/sync/src/extensions.ts`, the app's host in
`apps/browser/src/state/sync/extensions.ts`, Chrome's side in `engine/chromium/…/ardia/ac_extensions_sync.cc`).
- **What syncs.** Extensions from the Chrome Web Store that Chrome itself would sync (`sync_util::ShouldSync`:
  installed by the user from the store, not by default, policy or a component, not blocklisted, no other update
  URL), and not themes or apps. Unpacked extensions, Ardia Scripts and uBlock Origin (bundled) stay on their Mac. Per
  extension: on or off (the user's choice, Chrome's `DISABLE_USER_ACTION`), allowed in private windows, pinned to
  the toolbar (Chrome's saved pin, not whether it shows now). Not synced: its data and settings (`storage.sync`
  included), site access.
- **Installing.** A record for an extension this Mac lacks hands Chrome a sync install
  (`PendingExtensionManager::AddFromSync`, as `ExtensionSyncService` does); its updater fetches it from the Web
  Store with no prompt. Chrome 155's updater would grant the permissions of whatever version it fetched, so the
  install goes in with no version and Chrome installs it disabled whenever it has permission warnings. It is turned
  on only when the fetched version is the one approved on another Mac and its permissions (Chrome's permission ids
  and their hosts, `fps`) are among those approved for it (`ext:v:`); otherwise it stays off for its new permissions
  and the user turns it on with Chrome's prompt. A Mac publishes `ext:v:` only for a version whose permissions are
  granted there: a newer version replaces the record, the same version read with other permissions (another Chrome
  version) adds its reading to `fps`. The record is last-writer-wins, so two Macs approving different versions at
  once can briefly regress it; the newer Mac republishes its version on its next cycle. A record that arrives while
  an install is pending changes it before it lands, and an install isn't published until it has taken the synced
  state (its pin, which Chrome may have set by default). One that never lands is retried once per session, then
  hourly.
- **Removing.** Only the user's own removal (Settings › Extensions, the extension's menu, the Web Store, Chrome's
  extension page) is recorded, from the event Chrome reports (never from an extension going missing), with a
  revision Chrome's side mints so a quick remove and reinstall isn't lost. The record becomes `{ removed: true }`, a
  live value rather than a tombstone, so compaction and older Macs keep it. Sync never uninstalls anything: the
  other Macs keep their copy, stop installing it, cancel a sync install of it that's still waiting, and don't
  publish their copy back. An install of it that was already downloading still lands there, and isn't counted as
  the user's. Installing it again anywhere writes a newer record, which wins.
- **Joining** is a union: a joining Mac takes the synced state for extensions both have, keeps its own (and
  publishes them, also one the record says was removed). A Mac that was already syncing before this version
  doesn't publish an extension it holds a record for until it has applied that record.
- **Older Macs** (0.2.38, the 0.2.39 nightlies) keep `ext:` records in their replica and snapshots without
  applying them. A build whose engine lacks `ac_extensions_sync_*` publishes and applies nothing for extensions.
- Settings › Sync › What Syncs › Extensions turns it off; a profile that shares another's data has its owner's
  extensions.

### Passwords

Saved passwords are Chrome's (its password manager).
- **Reading.** Chrome's own API (`passwordsPrivate`) reveals a password only after device
  authentication, so sync asks the engine instead: `ac_passwords_logins` reads both of the profile's password stores
  through Chrome's `PasswordStoreInterface::GetAllLogins`, with no Touch ID prompt. The reply is built in one buffer
  that is wiped after it is sent, the bridge parses it from bytes it then wipes, and every `PasswordString` Chrome
  made for the read is zeroed when it goes (`chromium-password-string-erase.patch`). The strings Foundation parses
  can't be wiped; they live until the seal.
- **All or nothing.** A list reaches the adapter only when the engine answered with one. On the Mac one password that
  doesn't decrypt fails Chrome's whole read (`SkipUndecryptablePasswords` is off there, and nothing is deleted:
  Chrome never clears undecryptable passwords when `--user-data-dir` is set, which ArdiaHost always sets), and the
  engine refuses to read at all with that feature on. A store error, the profile going away mid-read, no reply within
  30 s or a malformed entry all give `null`, so the cycle skips passwords and nothing is tombstoned.
- **Sealed for JS.** Plain passwords never reach JS (#241). The native read gives JS each login's
  origin, username, creation time and the password sealed with the sync key (AES-256-GCM, its
  own HKDF key, bound to origin and username). The nonce is an HMAC of the login and password,
  so the same password seals the same on every Mac and the adapter can compare without opening
  it. Applying a remote password hands the sealed value back to `ArdiaSync.savePassword`, which
  opens it for that login only and writes through Chrome's API.
- **Keys.** Records are `pws:<origin>\n<username>` → `{ o, u, s }`. Builds before this used
  `pw:` with the plain password; new builds ignore `pw:` records and never tombstone them, so a
  Mac still on an old build keeps its passwords and syncs them only with other old builds until
  it updates. Those legacy records still never reach JS in the clear: `read` and `openLocal`
  seal each `pw:` value's `p` into `s` the same way and drop `pw:` entries from the local base,
  and `write` opens `s` back into `p`, so the folder keeps the old format and an old build's
  records survive a new build's compaction unchanged. The next local state checkpoint holds only
  the sealed form. A document with `pw:` records that can't be parsed or sealed (after replacing
  lone surrogate escapes, which `JSONSerialization` rejects) is never handed over in the clear:
  a folder file is reported as damaged, and a local state or journal file reads as missing while
  `sealLocal` and `write` refuse for the rest of the session, so the files on disk and the
  folder stay as they were and sync shows an error instead of saving a rebuilt state over them.
- **Writing.** Writes go through Chrome's API (`ArdiaServices.savePassword` from the sync module,
  `deletePassword` in `@ardia/ardiacore`), so Chrome's in-memory store and autofill see them at
  once. A changed password is a delete plus an add, done natively only after the sealed value
  opens: the update API needs the device check.
- **Safety.**
  - A read that finds any row it can't decrypt is skipped (a partial list would read as
    deletions).
  - After applying, sync waits until Chrome's store on disk shows the change before reading it
    again.
  - A login changed here but not read yet isn't overwritten.
  - Turning sync off, or turning Passwords off, never removes a password. Only a password
    deleted on another Mac is deleted here.
- **Cadence.** Passwords are read at most every 30 s (and at once with Sync Now; pressed while a cycle runs, the cycle after it reads them).

## UX (from Dia's binary)

Settings › Sync. Dia puts sync in Account › Sync, with the section icon
`arrow.triangle.2.circlepath`.

- **Off.** The row reads "Sync · Off", with **Turn On Sync** and **Enter Recovery Phrase…**. If
  the folder already has sync data, the primary button is **Enter Recovery Phrase…**, next to
  **Other Options** (Dia's menu: "Set Up Without Another Device", "Enter Recovery Phrase").
  Below is the sync folder, with Choose…. If iCloud Drive is off it says so, links to iCloud
  settings, and offers another folder; test instances never default to iCloud Drive.
- **Turn On Sync** makes a phrase and shows **Save Your Recovery Kit**, with Dia's copy:
  - "Your Recovery Kit contains all you need to recover your data should you lose access to
    this device."
  - "Save a copy of your Recovery Kit to another device or to the cloud. You'll need it if you
    lose access to this device.", with "another" underlined.
  - A preview of the page.
  - Buttons: Save…, Close, and Other Options (Copy, Share…, Save as Text…).
  - The PDF is "Ardia Recovery Kit.pdf", US Letter as Dia's, with the 24 words and a QR code.
- **Connect with Recovery Phrase.**
  - Dia's copy: "Enter your 24-word recovery phrase to sync with another device.", the
    placeholder "Enter your 24-word recovery phrase", the "%d/%d words" counter, "too many
    words", and Connect / "Connecting…" / Cancel.
  - Once connected, the sheet says "This Mac Is Syncing" and lists the synced profiles this Mac lacks, each with Add
    to This Mac, and Add All (Settings › Sync › Profiles offers the same). Until the profiles have paired it says
    "Looking for the profiles on your other devices…", with the files still downloading.
  - It also shows the folder the phrase is checked against, with Change….
- **On.**
  - The status line uses Dia's words: "starting up", "updating", "updated just now", "not
    syncing · last synced %@" and "offline" (the folder isn't there: a drive is unplugged, or
    iCloud Drive is off). Downloads still to come add "· waiting for N files to download".
  - **Connect Another Device…** shows the steps for the other Mac and a QR code of the phrase:
    scan it with an iPhone and paste it on the Mac with Universal Clipboard. It also has Show
    Words and Copy Words. Dia's version is an OTP between signed-in devices, which needs its
    server.
  - **Advanced…** has Save Recovery Kit…, Copy Recovery Code (Dia's ⌥ item, copied as
    `org.nspasteboard.ConcealedType`), Sync Now, Show Sync Folder in Finder and Stop Syncing….
  - Then Profiles (toggles, and Add to This Mac), What Syncs (Bookmarks, History, Open Tabs,
    Pinned Tabs and Groups, Passwords, Extensions, Settings) and Devices (each with "last synced …").
- **Stop Syncing This Device?** Dia's copy, plus "Everything on this Mac stays as it is", with
  Save Recovery Kit / Cancel / Stop Syncing.
  - Then **Delete Sync Data?**: "Would you also like to permanently delete your synced data
    from the sync folder? …", the checkbox "I understand this cannot be undone", and Keep Sync
    Data / Delete My Sync Data.
  - Stopping removes this Mac's tabs and name from the other devices and forgets the key. It
    keeps all local data.
  - Deleting removes this phrase's chain folder. The other Macs then show Dia's "This device is
    out of sync. Sync may have been reset from another device." and stop, keeping their data.
- **Overflow menu.** One other device with open tabs shows "Your %@ Tabs" (the kind of Mac, from
  its name: "Your MacBook Pro Tabs"). Several roll up into **Your Devices**
  (`macbook.and.iphone`), a submenu per device. Each lists "Recent Tabs"; picking one opens it
  in a new tab. The fallback name is "Unknown Device".

## Cycle

The engine (`apps/browser/src/state/sync/engine.ts`) runs a cycle 15 s after the last one, 3 s after a
bookmark, settings, profile or group edit, and on Sync Now. A cycle:
1. Checks the chain folder: gone means reset elsewhere; the folder missing means offline.
2. Syncs the app scope and links profiles.
3. Syncs each synced profile's scope, publishing, flushing, pulling, and then publishing and
   applying per adapter.
4. Compacts when due.
5. Saves `sync.json` (in the app's data folder): links, settings of sync and the last seq written
   per scope; and `sync-state.nns`, sealed: the replica, base, version vectors and known files.

## Tests

- `pnpm --filter @ardia/sync test`:
  - `swift test`: 5 tests. BIP39 reference vectors; tampering and truncation are detected; the
    wrong phrase opens nothing; the folder holds no plaintext in names or contents; deleting one
    chain leaves another.
  - `node --test`: 28 tests. Extensions (19): install with state and approval, no echo; on/off,
    incognito and pin both ways; a removal as a live record, never reinstalled, beaten by a reinstall; an uninstall and
    reinstall before publishing; union on joining; a joiner takes the synced state; no grant for a newer store version
    or other permissions; a grant for a Mac that already has the approved version; a missing or null record and an
    ineligible extension never remove anything; nothing before Chrome is ready; a lost pending install retried; a
    change while pending; a removal cancels a pending install; an older Mac keeps the records through its snapshots;
    an upgraded Mac doesn't republish a copy whose removal it held; another Chrome's reading of the same version's
    permissions is added without a loop; an install still settling isn't published; on a framework without the engine
    calls nothing is published or applied and the records wait. The rest (9): Concurrent edits converge in any order; deletes, re-adds and
    edit-after-delete; clock skew; late, out-of-order and half-copied files; an edit during a read;
    an old snapshot put back after its tombstones were collected; a tombstone kept past its age
    limit while an older log is missing, for twice the limit at most; a write that fails before or
    after the file lands; 40 randomized three-device runs with flaky delivery, compaction and crashes.
- `pnpm --filter @ardia/browser test` runs `src/state/sync/adapters.test.mjs` (4 tests against the real
  store: delete versus add, concurrent moves that would make a cycle, parked pinned tabs, passwords
  both ways), `src/state/sync/pinned.test.mjs` (the pinned area's adapters in their order: a row and a tile folder land as
  such, an unpin deletes the marks with the pin, the app's old names are read as today's, pinned group tabs' homes go across and
  survive a Mac on the previous version) and `src/state/sync/engine.test.mjs` (the engine against a fake native module: a crash the
  moment a batch lands re-sends the journalled batches byte for byte and numbers the next one after
  them; nothing is published before its journal is on disk).
- End to end: `node packages/sync/scripts/e2e.mjs [Debug app] [work dir]` drives two hidden
  instances (then a third) with their own data folders through a temporary sync folder, never
  iCloud Drive, over the dev harness. It checks 54 things, and all 54 passed on 2026-10-21 (Debug
  build), including pinned rows, tiles and a pinned group, an unpin, and B quit and relaunched.
  - Extensions, with real Chrome Web Store extensions over the network (Picture-in-Picture by Google, Google
    Translate): A installs one through Chrome's updater with no prompt; it comes in off for its permissions until
    A's user accepts Chrome's prompt; then it reaches B approved and on (same version, same permissions). A's
    disable turns it off on B; B's enable and pin reach A. B quit while an install was pending installs it after
    relaunching. B's removal makes the record `{ removed: true }` on both; B doesn't install it again, and A keeps its
    copy without publishing it back.
  - B rejects four wrong phrases: someone else's valid phrase ("mismatch"), two words swapped
    (checksum), a word not on the list, and 23 words. Then it joins with the kit's numbered, upper-case lines.
  - After joining: A's bookmarks, history, pinned tab (unloaded) and password (in Chrome's password
    manager) are on B, and B's own bookmark and password are on A. B took the synced settings.
    The two converge.
  - B's rename, delete and new bookmark, history delete and new visit, settings (a null one
    included), and password change and delete all reach A. A's move out of a folder, folder
    delete, new bookmark in Other Bookmarks, new pinned tab and new password reach B.
  - Open tabs: A shows B's tabs but not its pinned ones. "Your … Tabs" with "Recent Tabs" for one
    device, "Your Devices" for two.
  - Concurrent edits to one bookmark, one setting and one password converge, and the later edit
    wins. Idle rounds write no files.
  - A half-copied file and an iCloud placeholder aren't applied ("waiting for 1 file"). Both apply
    once whole.
  - The folder: no plaintext in names or contents (13 strings searched: titles, URLs, the password,
    usernames, device and setting names), every file padded to 1 KiB. Each Mac's own sync state
    holds no plaintext password.
  - A third Mac joins from the folder as it is (logs and a snapshot) and converges.
  - Turning sync off on B keeps its bookmarks, history, settings, pinned tabs and passwords, and
    removes its key. A drops B's device and tabs, and what B does while off stays on B.
  - Delete My Sync Data on A empties the folder. C shows Dia's reset message and stops, and A and C
    keep all their data.

  The runs found and fixed:
  - Settings whose value is null bounced between Macs: a null record is a tombstone, so settings
    are now wrapped.
  - Two instances launched in the same millisecond made the same store ids: `newId` now has a
    random part.

## Left for a person

A real two-Mac run over iCloud Drive: turn on sync on one Mac, save the kit, enter the phrase on
the other, and watch bookmarks, history, pinned tabs, passwords and settings go both ways. Also
check the iCloud Drive permission prompt, if macOS shows one the first time. The tests use a
temporary folder, never iCloud Drive.
