# Where Kelp is (2026-10-16)

## M4: built, not merged

All M4 code is written, tested (Rust 195, frontend 199 passing) and pushed, but **none of it is on `master` yet**.
The branches are stacked, each built on the one before. Open and merge the PRs **in this order**, waiting for CI on each:

1. `m4-drop-polish`
2. `m4-settings`
3. `m4-palette`
4. `m4-preview`
5. `m4-tabs`
6. `m4-copy-engine`
7. `m4-row-drag`
8. `m4-done` (SPEC and README say M4 is done)
9. `m4-preview-refresh` (preview button, double-click preview, Refresh / ⌘R, preview fit, faster video)

PR links: `https://github.com/Ozan797/Kelp/pull/new/<branch>`. After merging one, open the next against `master`.
Merging the last one brings in everything, so merging only `m4-preview-refresh` into `master` also works if you
prefer one big PR.

### Before calling M4 finished, try by hand

- ⌘W, ⌘T, ⌘⇧[ ] with tabs; no theme flash on launch.
- Preview: images, text, video seeking.
- Drag rows to move (and ⌥ to copy) inside a connection; drag onto another connection to copy.
- A large copy between Hetzner and S3: pause, quit, reopen, resume.
- Moving a folder of about 1,000 files.
- R2 has never been tested by hand (needs access).

## Next: Keychain with Touch ID (start of M5)

Problem: the app asks for your Mac password on every launch, once per connection. Unsigned dev builds change on
each rebuild, so "Always Allow" never sticks.

Plan:
- **Release builds:** one data-protection Keychain item for all secrets, locked with "user presence" (Touch ID, or
  your password without it). Needs Developer ID signing and a provisioning profile with `keychain-access-groups`.
- **Dev builds** (`tauri dev` runs a bare binary that can't carry a profile): sign with your Apple Development
  certificate and keep one legacy Keychain item, so "Always Allow" sticks across rebuilds.
- Move existing per-connection items into the new one on first launch.

What to have ready on the laptop you build on:
1. Team ID (developer.apple.com → Account → Membership details).
2. Certificates "Apple Development" and "Developer ID Application" installed. Check with
   `security find-identity -v -p codesigning`.
3. App ID `dev.ozanai.kelp` and a Developer ID provisioning profile for it (don't commit it yet).

Then: short spec, plan, build on a new branch from `master` (after the M4 PRs are merged).

## M5: release (SPEC §4, §9)

- Code signing and notarisation in `.github/workflows/release.yml` (certificate `.p12` and Apple ID details as
  GitHub secrets).
- Auto-update with `tauri-plugin-updater` (SPEC §9.1). The updater signing key is generated once and backed up in
  a password manager. **No public build without the updater.**
- Landing site live on a subdomain of `ozanai.dev`; `SITE.released` stays `false` until a `.dmg` is on a release.
- Test the updater by installing v0.1.0 and then releasing v0.1.1.

## Still open

- ⌘W on the last tab: do nothing (now) or close the window like Finder?
- SPEC §12: final name and subdomain; open or closed source.
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
