# Kelp: update experience and "What's new"

Date: 2026-10-17
Status: agreed in conversation; written design

## 1. Why

The 0.1.0 → 0.1.1 update worked end to end, but the experience around it didn't:

- The developer had Kelp open when 0.1.1 was published, and nothing appeared. Kelp only checked at launch and every
  6 hours, so the update was only found when they clicked **Check for updates…**.
- The banner is a full-width bar above the status bar. It reads like an error, and its "Release notes" dropdown is a
  cramped place to explain what changed.
- One sentence in a tag message isn't enough to tell people what's new. The developer wants a proper list of changes
  with animations, like the landing page, on the website.

Success: an open Kelp notices a published update within about half an hour, shows it quietly in a way that looks like
part of Kelp, and its **What's new** button opens a good-looking page on `kelp.ozanai.dev` about exactly that version.
Every future release ships with that page, written by the Claude chat that cuts the release.

## 2. Goals, non-goals, anti-goals

**Goals**
- Check for updates often enough that an open app finds a new version within ~30 minutes.
- Replace the banner with a quiet status-bar indicator and a small card.
- A public "What's new" page on the website, one page with every version, newest first.
- Release notes written as part of every release and live the moment the update is offered.

**Non-goals**
- In-app release notes (the dropdown goes away; the website is the one place).
- Changes to how updates are built, signed, uploaded or published (`docs/RELEASING.md` stays as is, plus one step).
- Auto-installing updates without the user clicking.

**Anti-goals** (would be a failure even if it technically works)
- Anything that looks generic or "vibe coded": new colours, gradients, icon tiles, emoji, pill shapes that don't exist
  elsewhere in Kelp. It must look like Kelp's own UI.
- Interrupting work: no popups over the file list, no focus stealing, no sound.
- A **What's new** button that opens a page without that version's notes.
- Buttons that wrap or squash.

## 3. Update checks (app)

- Check at launch, then every **30 minutes** while Kelp is open (was 6 hours).
- Also check when Kelp's window becomes active again if the last check was 30 minutes or more ago (covers a Mac that
  slept overnight).
- Unchanged: one check at a time; a found update downloads in the background before anything is shown; a timed check
  that finds nothing or fails stays silent; dev builds never check.
- Cost: `latest.json` is under 1 KB; ~50 requests per open copy per day.

## 4. The status-bar indicator and card (app)

Agreed look (option 3 from the mockups): **a small download-arrow icon in Kelp's teal followed by "Update ready" in
the status bar's normal text**, at the right-hand end of the status bar. Icon and words are one button.

- It appears only when an update has been downloaded and is ready to install.
- On first appearance it pulses gently once. No motion with Reduce Motion on.
- It's a real button: reachable with Tab, visible focus ring, accessible name "Update ready, Kelp 0.2.0".
- The status bar is rendered in two places in the app (inside a connection, and with no connection open); the
  indicator shows in both.

Clicking it opens **the card**, anchored above the indicator:

```
┌──────────────────────────────────────────┐
│ Kelp 0.2.0 is ready                    × │
│ Kelp now remembers where you were in     │
│ each folder.                             │
│                  [What's new] [Restart to update] │
└──────────────────────────────────────────┘
```

- Title: "Kelp <version> is ready". Text: the release's one-line summary (§6).
- **What's new** (secondary button) opens `https://kelp.ozanai.dev/whats-new/#<version>` in the default browser.
- **Restart to update** (primary button) installs and relaunches. If transfers are running it asks first, as today:
  "3 transfers are running. Restart now? They'll resume after Kelp reopens." Install failure shows today's message.
- **×** in the top-right corner dismisses this update: the card closes and the indicator disappears until the next
  launch or a newer version. **Check for updates…** brings it back.
- Escape or clicking outside closes the card only; the indicator stays. Focus returns to the indicator.
- Buttons stay on one line; the card is wide enough for both (about 320 px).
- **Check for updates…** (menu and ⌘K) always answers: if an update is ready it opens the card; otherwise the card
  shows "Kelp is up to date (<version>)." or "Kelp couldn't check for updates. Check your internet connection and try
  again." with only the ×. In dev builds: "Updates are off in development builds."

**Look** (anti-goal above): built only from existing Kelp parts and semantic tokens. The indicator is plain status-bar
text plus one line icon; the card uses the same surface, border, radius, shadow, type sizes and button styles as the
Settings sheet. Light and dark mode both work from the tokens. The final mockup is
`docs/superpowers/specs/assets/2026-10-17-update-indicator-mockup.html` (option 3, and the card at the bottom). Its
colours are hand-copied for the mockup only; the build uses the semantic tokens.

**Placement and state** (my calls):
- Update state lives once, near the top of the app, shared by both status bars and one card. Dismissal (×) is kept for
  the session only, never saved to disk.
- With an update ready, the card opens anchored above the indicator. When there's no indicator (a "Check for
  updates…" answer), it opens above the right-hand end of the status bar.
- After several skipped releases, the card shows the newest version's summary only, and **What's new** opens
  `#<newest>`; earlier versions sit just below it on the page.

The current `UpdateBanner`, its Release notes dropdown and **Later** button are removed.

## 5. The "What's new" page (website)

- URL `https://kelp.ozanai.dev/whats-new/`, added to the header and footer next to Docs. A new prerendered page (a
  `PAGES` entry in `config.ts` and a `ROUTES` entry in `routes.tsx`, per CLAUDE.md).
- One scrolling page, newest version first (option A from the mockups). Each version is a section with `id="<version>"`
  so `/whats-new/#0.2.0` lands on it:
  - heading: version and date, with a "Latest" label on the newest;
  - an optional **scene**: a small replica of Kelp's window, built the same way as the landing page's demo window
    (`website/src/components/DemoWindow.tsx`, fake data from `website/src/data.ts` only, never real bucket names or
    keys), playing a short loop of the change (my call on how rich: "like the landing page"). A plain screenshot or
    short recording can stand in when a scene is overkill;
  - a list of changes, each a short bold headline and one plain sentence.
- Scenes respect Reduce Motion (show a still frame) and don't play until scrolled into view.
- The page shows only versions up to the live release (my call). The site redeploys on pushes to `master` that touch
  `website/`, so a merged notes entry would otherwise appear before Publish. The build already knows the live version
  (it reads `latest.json` through R2's API in CI); entries newer than it are left out until Publish redeploys the site.
- Backfill entries for 0.1.0 (first release: browse and transfer across S3, R2 and Hetzner; Touch ID keys; signed and
  notarised; auto-update) and 0.1.1 (folders remember where you were and open instantly), with a scene for 0.1.1: a
  folder list scrolled down, a folder opens, the window goes back, and the list is exactly where it was. Its still
  frame (Reduce Motion) is the scrolled list.

## 6. Writing and shipping release notes

- Release notes live in the repo under `website/`, one entry per version: version, date, one-line summary, list of
  changes, optional scene or image. The text is plain data (no JSX) so scripts can read it; scenes are separate
  components.
- The one-line summary is the single source for the app's card and `latest.json`'s `notes`; the GitHub draft
  release's text is built from the same entry (summary and list). The release workflow reads them from the entry and
  no longer uses the tag message. (My call: one place to write it.)
- The release workflow fails early, before building, if the tagged version has no notes entry, with a message saying
  where to add it. That guarantees the page exists before anyone is offered the update.
- **Who writes them:** the Claude chat cutting a release. It reads the commits and merged PRs since the last tag,
  writes the entry and the summary in the site's voice (sentence case, plain words), builds the scene for the main
  change when there is one, and shows the developer the entry to approve before tagging. The entry goes in the same
  PR as the version bump.
- `docs/RELEASING.md` gets a "Write the release notes" step before tagging, and the version-bump step names the notes
  entry as one of the files.
- Publish already redeploys the website, so the notes are live when installed copies are offered the update.

## 7. Constraints

- CLAUDE.md applies: no comments; strict TypeScript; Tauri calls only through `app/src/lib/tauri.ts`; semantic tokens
  only; visible focus; respect Reduce Motion; UI copy in sentence case, buttons say what they do.
- Opening the page uses the existing opener permission, which already allows `https://kelp.ozanai.dev/*`. No new
  capabilities.
- Website rules: names and URLs in `config.ts`; page functions return layouts and use no hooks (state goes in child
  components); the demo-style scenes use fake data only.
- The update address `https://kelp-dl.ozanai.dev/latest.json` must not change.

## 8. Left to the builder

- Component and file names, how the notes data is shaped in TypeScript, and how scenes are registered.
- Exactly how "window became active" is detected and debounced.
- The pulse animation, within §4 and the tokens.
- How the card is positioned and how focus is trapped/returned, within §4.
- Tests: hook timing (30 minutes, focus check), indicator and card behaviour and copy, the × dismissal rules, the
  website page and anchors, the notes-entry check in the release workflow.
