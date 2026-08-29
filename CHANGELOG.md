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
- **Plex rewrites a transcoding session's own Media/Part/Stream fields to
  describe the transcode OUTPUT, not the source file** — confirmed via a
  live session dump: `height`, `videoResolution`, and `audioCodec` all
  reported the transcoded values (e.g. `720p`/`ac3`) even on a genuinely
  1080p/EAC3 source. The only place the source survives is the video
  Stream's own `displayTitle` text (e.g. `"1080p (H.264)"`) and
  `TranscodeSession.sourceAudioCodec`. See 2026-08-28 9:43 PM below.
- **Real credential files (`streampulse.jsx`, `PlexConfig.swift`) now
  live entirely outside this repo folder**, not just gitignored inside
  it — a stray copy of `streampulse.jsx` ended up committed once despite
  the ignore rule, which only a file never being physically present in
  the repo directory fully rules out. See 2026-08-28 11:47 PM below.

---

## 2026-08-29

- **5:10 PM** — `[Changed]` Bumped to version 1.3; synced
  `uebersicht/streampulse.example.jsx` with the live widget (placeholder
  credentials only, as always) and rebuilt `streampulse.widget.zip` from
  the synced file.
- **4:55 PM** — `[Changed]` Move handle relocated to the widget's true
  top-right corner (absolute-positioned, mirroring the existing
  bottom-right resize handle); the StreamPulse logo/heartbeat group now
  sits flush against the right edge of the header row instead of
  floating between the title and streaming count.
- **4:40 PM** — `[Changed]` Bigger Plex avatar in the header; the
  connected server's name now renders in a distinct rounded font instead
  of the default system font.
- **4:20 PM** — `[Fixed]` Debounced the "Can't reach server" error
  banner (a single tracked timer reset on every new failure instead of
  each 2-second poll scheduling its own independent auto-clear) — it no
  longer flickers on/off throughout an ongoing outage.
- **4:00 PM** — `[Added]` Offline state now shows a red flatline
  heartbeat with the same traveling-pulse sweep animation used for the
  connected state, instead of a static line.
- **3:30 PM** — `[Fixed]` Dropped JSX fragment shorthand (`<>...</>`)
  from the header and About-panel heartbeat SVGs — Übersicht's compiler
  has no `React.Fragment` in scope, the same class of bug hit and fixed
  earlier in the project's history (see 2026-08-27, 1:03 PM).
- **3:00 PM** — `[Changed]` Simplified the header branding down to the
  StreamPulse wordmark plus a single animated heartbeat-monitor line
  (removed an earlier three-dots-and-bar decoration), resized and
  visually connected to the wordmark's trailing "e".
- **2:30 PM** — `[Added]` About panel — click the logo to see the
  installed version, license, and a link back to this repo; matches the
  widget's own chosen background color/opacity instead of darkening the
  widget behind it.
- **2:00 PM** — `[Changed]` Replaced the Plex logo in the header (and
  About panel) with StreamPulse's own logo, animated with a moving
  heartbeat-monitor line at the end of the wordmark.
- **1:30 PM** — `[Fixed]` Background-color swatches and the opacity
  slider now share a guaranteed common left edge (CSS grid instead of
  two independently-sized flex rows) instead of only coincidentally
  lining up.

## 2026-08-28

- **11:47 PM** — `[Changed]` Moved the real `PlexConfig.swift` out of the
  repo entirely (now maintained outside the repo folder, alongside the
  real `streampulse.jsx`); stopped tracking `streampulse.widget.zip` and
  two unused gallery images (`screenshot.png`,
  `StreamPulse v1.2.png`) — the zip belongs on the GitHub Release instead
  of committed to history.
- **11:34 PM** — `[Docs]` Swapped the README's gallery image.
- **11:28 PM** — `[Changed]` Reset the repository's git history to a
  clean baseline as a precaution after a real credentials file was
  briefly committed — see the Noteworthy entry above.
- **9:43 PM** — `[Fixed]` The resolution/audio badge ("1080p → 720p"
  style) actually shows the original quality again instead of just the
  currently-streamed one — root cause and fix in the Noteworthy entry
  above.
- **9:23 PM** — `[Added]` Hide button for individual Recently Added
  categories (Movies, TV Shows, Music, Screeners, etc.), mirroring the
  existing top-level section hide/show pattern — hidden categories
  collect in the same "Hidden: …" footer chip row and can be restored
  with a click.
- **7:50 PM** — `[Fixed]` Recently Added's poster glow was bleeding into
  the next (hidden, paged-out) poster past the visible 4 — retuned the
  carousel viewport's clip padding so it's cut off before that neighbor's
  glow shows.
- **7:25 PM** — `[Fixed]` Now Playing tile glow was getting clipped at
  the widget's left/right edges; padding now matches the widget's own
  side padding so the glow fades out naturally instead of hitting a hard
  edge.
- **7:10 PM** — `[Changed]` Drag-to-move handle now stays hidden until
  the widget is hovered, matching the existing resize-handle behavior.
- **6:50 PM** — `[Changed]` Avatar repositioned to an absolute corner
  badge (top-right of the tile) sized independent of tile height; "Added
  on" date moved next to the Stop button instead.
- **6:25 PM** — `[Added]` User's Plex avatar shown on Now Playing tiles.
- **6:15 PM** — `[Added]` "Added on <date>" shown inline with the title
  on Now Playing tiles (e.g. "Added on February 4th, 2026").
- **6:10 PM** — `[Added]` Resolution and audio format shown inline after
  the Direct Play/Transcoding badge — e.g. "1080p → 720p" when the
  actual stream is downscaled from the source.
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
