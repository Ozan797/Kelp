# Where Kelp is (2026-10-16)

## M4: merged

M4 is on `master`. The checks below are still undone.

### Before calling M4 finished, try by hand

- ⌘W, ⌘T, ⌘⇧[ ] with tabs; no theme flash on launch.
- Preview: images, text, video seeking.
- Drag rows to move (and ⌥ to copy) inside a connection; drag onto another connection to copy.
- A large copy between Hetzner and S3: pause, quit, reopen, resume.
- Moving a folder of about 1,000 files.
- R2 has never been tested by hand (needs access).

## M5 part 1: Keychain with Touch ID and local signing — built

Spec: `docs/superpowers/specs/2026-10-16-kelp-keychain-touch-id-design.md`.

Needs `app/src-tauri/Kelp.provisionprofile` first (README → Signing).

### Try by hand

- `codesign -d --entitlements - Kelp.app` lists `keychain-access-groups`.
- Existing connections open after one Touch ID prompt (plus one Mac password prompt per old item, once); Keychain
  Access no longer shows per-connection `dev.ozanai.kelp` items.
- One prompt per launch, however many connections or tabs open.
- Cancel the prompt: the "Touch ID was cancelled" message shows; open again, succeed.
- Add, edit and delete a connection without a second prompt; relaunch; the right ones open.
- A build run without the profile embedded shows the "isn't signed to use the Keychain" message.
- `tauri dev`: click Always Allow once, rebuild twice, no password prompt.

## M5 part 2: signed releases, auto-update, website — built

Spec: `docs/superpowers/specs/2026-10-16-kelp-m5-release-design.md`. Needs the one-time setup in its section 8.

### First release, by hand

- [ ] Tag `v0.1.0`: the build passes, `releases/0.1.0/` has four files, a draft release exists.
- [ ] The `.dmg` opens on a Mac that has never run Kelp, with no warning (`spctl -a -vv Kelp.app` says "Notarized Developer ID").
- [ ] Publish `0.1.0`: `latest.json` and `Kelp_aarch64.dmg` are live; the site shows "Version 0.1.0" and a working button.
- [ ] Install 0.1.0, then tag and publish `0.1.1`: 0.1.0 shows the banner, restarts into 0.1.1, keeps its connections.
- [ ] With a transfer running, Restart asks first.

## M5: release (SPEC §4, §9)

- `release.yml` fails on a `v*` tag until it gets `KELP_TEAM_ID`, `APPLE_SIGNING_IDENTITY` and the provisioning
  profile (base64) as secrets.

## Still open

- ⌘W on the last tab: do nothing (now) or close the window like Finder?
- SPEC §12: final name and subdomain.
- Analytics: decisions in §6 of `docs/superpowers/specs/2026-10-15-kelp-analytics-design.md` (after M5 or
  alongside it).
- Real-bucket tests need a `.env.test` (never committed).

## Deferred small issues from the M4 reviews

None lose data. Pick them up when convenient.

- Dragging again while a check runs shows the drag pill on top of the checking pill.
- A test repeats the FolderPlan shape instead of importing the type.
- A failed settings save leaves the theme changed for the session (an alert is shown).
- Sheets don't return focus to the button that opened them.
- ⌘, does nothing while a text field has focus.
- The ⚙ glyph uses a raw font size and isn't `aria-hidden`.
- Palette: Tab leaves it; ⌥/⌃ with a shortcut still triggers it; "No matches" sits inside the listbox; ⌘K doesn't
  close it.
- Preview: Space opens the first selected file, not the focused row; Space and arrows on video controls close or
  step instead of play or seek; the 1 MB text cut can split a character; all provider errors map to 502; no
  `nosniff` header on preview responses.
- Tabs: a new tab's label flickers; closing a tab saves its place as the connection's last location; a drag that
  leaves an inactive tab can leave a stale overlay; every tab reloads on each finished upload; switching tabs with
  the drawer open re-focuses it.
- Copy engine: a finished move not yet saved can show as failed after a restart; two keys mapping to one
  destination both copy; no progress during server-side copies; the fake ignores buckets and part sizes; the 5 GiB
  and 512 MiB copy limits have no pure test; copies inside R2 untested.
- Row drag: the source bucket is read at drop time; CopySheet lacks loading text, clears no errors, shows only the
  first page of folders, has no Tab trap and doesn't reopen on the last folder; an Escape-cancelled drag lets the
  release click replace the selection; your own bucket root isn't highlighted; breadcrumbs accept Finder drops
  without a highlight; the overwrite sheet for moves doesn't say originals are removed; selecting on press doesn't
  update the shift-click anchor; two profiles for one account can copy a folder into itself.
