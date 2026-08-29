# Changelog

Everything changed in this repo since **2026-08-26** (project start), in the
order it actually happened. Times are Central (America/Chicago), matched to
each commit's own timestamp — dates roll over at midnight Central.

This project doesn't use version-numbered release notes for every commit, so
this file is a straight chronological log instead: `[Added]` new capability,
`[Changed]` existing behavior adjusted, `[Fixed]` a bug or visual glitch
corrected, `[Docs]` README/documentation only. A short **Noteworthy** block
sits at the top for things worth knowing about the project as a whole, not
tied to one commit.

---

## Noteworthy

- **Native WidgetKit version drops App Groups entirely.** A shared
  App-Group container between the app and the widget extension turned out
  to be unreliable under a free/personal Apple ID — writes to shared
  `UserDefaults` were silently blocked by the sandbox no matter how the
  capability was reconfigured. The fix was architectural, not cosmetic:
  both targets now read Plex credentials directly from a compiled-in
  `Shared/PlexConfig.swift` (gitignored), the same pattern the Übersicht
  widget already used. See 2026-08-27 11:30 PM below.
- **WidgetKit requires `.containerBackground(for: .widget)`** on macOS
  14+/iOS 17+, and the widget's declared deployment target has to actually
  say 14.0+ for that to take effect — missing either one shows a system
  placeholder ("Please adopt containerBackground API") instead of any real
  content. Both were fixed the same night (11:49 PM and 11:52 PM,
  2026-08-27).
- **Übersicht's JSX compiler has no `React.Fragment` in scope** — a bare
  `<>...</>` shorthand silently breaks the entire widget rather than
  erroring cleanly. Hit and fixed early on (see the 1:03 PM entry below).

---

## 2026-08-28

- **12:49 AM** — `[Docs]` README rewritten to actually describe the
  Übersicht widget's full interactive feature set: Recently Added paging
  (`‹ ›` through the last 20 per category) and category reordering
  (`▲ ▼`), Now Playing scrolling/pull-to-refresh/stop-a-stream, the two
  update badges (Plex server + StreamPulse self-update), section
  show/hide + reorder, background opacity slider, corner-drag resizing —
  and clarified that the WidgetKit version has none of that (read-only,
  no paging/reordering/update badges).

## 2026-08-27

- **11:52 PM** — `[Fixed]` Raised the native widget's deployment target to
  macOS 14 — required for `.containerBackground` to actually take effect;
  leaving it at 13.0 kept showing the placeholder even with the modifier
  in place.
- **11:49 PM** — `[Fixed]` Added the required `.containerBackground` view
  modifier so the native widget renders its real content instead of the
  system's "Please adopt containerBackground API" placeholder.
- **11:30 PM** — `[Docs]` Updated the WidgetKit setup instructions in the
  README for the new App-Groups-free flow (`PlexConfig.swift.example` →
  copy, fill in, `xcodegen generate`).
- **11:30 PM** — `[Changed]` Dropped App Groups from the native widget
  entirely; both targets now hardcode Plex config the same way the
  Übersicht widget does (see Noteworthy above).
- **11:13 PM** — `[Changed]` Updated the `StreamPulse v1.2.png` gallery
  screenshot.
- **10:52 PM** — `[Fixed]` Made the (since-removed) Settings window's Save
  button actually report success/failure instead of silently doing
  nothing — superseded 40 minutes later when the Save/App-Groups flow was
  replaced outright (see 11:30 PM above).
- **10:33 PM** — `[Fixed]` Defaulted `project.yml` to automatic code
  signing — fixes Xcode's "requires a provisioning profile" error on a
  fresh `xcodegen generate`.
- **10:21 PM** — `[Added]` XcodeGen spec (`project.yml`) so the native
  macOS widget's Xcode project can be generated instead of clicked
  together by hand.
- **9:07 PM** — `[Docs]` README update.
- **8:51 PM** — `[Added]` New gallery screenshot asset uploaded.
- **8:19 PM** — `[Fixed]` Update-checker tag parsing for
  `streampulse_v`-prefixed release tags (was only handling a plain `v`
  prefix).
- **8:18 PM** — `[Added]` StreamPulse's own update checker — compares the
  widget's built-in version against the latest published GitHub release
  and surfaces a clickable "StreamPulse update available" badge.
- **8:05 PM** — `[Changed]` Updated the gallery screenshot for v1.2.
- **7:51 PM** — `[Fixed]` Pull-to-refresh now only triggers from a gesture
  that starts already scrolled to the top (was firing from mid-scroll
  too).
- **7:24 PM** — `[Changed]` Resize handle now stays hidden until the
  widget is hovered.
- **5:43 PM** — `[Changed]` Bumped to version 1.2; rebuilt the release zip
  with the latest widget code.
- **5:37 PM** — `[Fixed]` Added horizontal breathing room to the poster
  carousel viewport.
- **5:34 PM** — `[Changed]` Recently Added's poster paging now slides
  instead of instant-swapping.
- **5:08 PM** — `[Fixed]`/`[Added]` Fixed Screeners' mispositioning;
  added 20-item poster paging to Recently Added.
- **4:58 PM** — `[Changed]` Synced scroll padding to `BUFFER`, raised
  `MAX_WIDTH` so a 4th Recently Added category can fit.
- **4:45 PM** — `[Fixed]` Hidden-tile glow bleed fixed; Recently Added
  groups now flow inline.
- **3:09 PM** — `[Fixed]` Fast scroll-to-bottom no longer collapses the
  scroll cap down to a single tile.
- **3:09 PM** — `[Changed]` Reverted Recently Added's grid back to
  `1fr`/`auto` — it was already responsive without the extra rule.
- **3:05 PM** — `[Changed]` Recently Added now reflows on resize; moved
  the resize handle off the footer.
- **3:01 PM** — `[Added]` Drag-to-resize handle for the widget's width.
- **2:55 PM** — `[Fixed]` Now Playing snaps back to the top once a
  pull-to-refresh commits.
- **2:50 PM** — `[Fixed]` The section divider now follows whichever
  section is actually last, instead of a hardcoded one.
- **2:46 PM** — `[Fixed]` Dropped the stray divider under the last
  (Bandwidth & CPU) section.
- **2:44 PM** — `[Added]` Plex-orange divider bar between every section.
- **2:33 PM** — `[Fixed]` Pull-to-refresh twitch fixed by freezing the
  scroll-cap height during the pull gesture.
- **2:15 PM** — `[Changed]` Scroll hint now shows a both-direction arrow
  when mid-scroll.
- **2:11 PM** — `[Fixed]` Removed leftover CSS `scroll-snap` that was
  causing tiles to start mid-scroll.
- **2:09 PM** — `[Fixed]` Scroll-more-hint arrow is now state-driven so it
  stops reverting to the wrong direction.
- **2:04 PM** — `[Fixed]` Fixed a double-counted buffer in the scroll cap
  that caused a 3rd tile to peek/clip.
- **1:50 PM** — `[Fixed]` Scroll cap now sizes tightly for whichever tile
  pair is currently topmost, not a fixed pair.
- **1:43 PM** — `[Fixed]` Reserved an explicit 16px top buffer in the
  scroll cap — was clipping the top tile's glow/border at the
  bottom-scrolled position.
- **1:41 PM** — `[Fixed]` Root-caused top-tile clipping: the scroll cap
  now sizes off the tallest tile actually present, not whichever two
  happen to be first.
- **1:31 PM** — `[Fixed]` Scroll-more hint flips to point up once
  scrolled to the bottom; reinforced with `scroll-snap-stop: always`.
- **1:25 PM** — `[Changed]`/`[Fixed]` Pull-to-refresh now drags the tiles
  down along with the spinner instead of leaving them static; fixed the
  scroll-cap selector after wrapping tiles in `.now-playing-tiles`.
- **1:21 PM** — `[Fixed]` Pull-to-refresh indicator taken out of normal
  flow so pulling never grows the widget or pushes lower sections down.
- **1:14 PM** — `[Fixed]` Now Playing never caps/scrolls below 3 tiles —
  removed a sliver-of-scroll bug that could appear at exactly 2 streams.
- **1:07 PM** — `[Added]` Header now shows the paused-stream count next to
  the streaming count.
- **1:06 PM** — `[Fixed]` Moved the scroll-more hint outside the scroll
  cutoff instead of overlaying the last visible tile.
- **1:03 PM** — `[Fixed]` Dropped a JSX Fragment (`<>`) around the
  scroll-more hint — Übersicht's compiler has no `React.Fragment` in
  scope, and it was silently breaking the entire widget.
- **1:00 PM** — `[Added]` Now Playing shows a bouncing-arrow "Scroll for
  more" hint once 3+ streams are active.
- **12:12 AM** — `[Docs]` README update.

## 2026-08-26

- **10:12 PM** — `[Docs]` README update.
- **9:58 PM** — `[Docs]` Documented the Releases-zip install path
  (`index.jsx`) alongside the git-clone path.
- **9:36 PM** — `[Docs]` Documented the 24h recently-added glow,
  playing/paused tile state, and in-widget library refresh.
- **9:29 PM** — `[Added]` Added `widget.json`, `screenshot.png`, and
  `streampulse.widget.zip` for gallery submission.
- **3:05 PM** — `[Docs]` README update.
- **3:01 PM** — `[Docs]` README update.
- **2:39 PM** — `[Changed]` Renamed the project to StreamPulse (dropped
  "Plex" from the name/branding).
- **1:22 PM** — `[Docs]` README update.
- **11:45 AM** — `[Changed]` Renamed the widget file to `plexpulse.jsx` to
  match the project name at the time.
- **11:44 AM** — `[Changed]` Stopped tracking the real widget file in git
  — only the placeholder `.example.jsx` stays tracked from here on, so
  real Plex credentials never land in the repo.
- **11:38 AM** — `[Added]` Initial commit — PlexPulse: a Plex status
  widget for Übersicht, plus an optional native WidgetKit version.
