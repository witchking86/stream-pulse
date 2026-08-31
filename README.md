# <img width="305" height="102" alt="image" src="https://github.com/user-attachments/assets/a74f9b96-120e-4236-8bc8-3ba992eccdde" />

A live status widget for your Plex Media Server, built for macOS.

**Version 1.4** · Created by **Witchking86**.

Two versions live in this folder:

- **`uebersicht/streampulse.example.jsx`** — the recommended one. Now Playing and
  system stats refresh every couple of seconds; requires the free
  Übersicht app.
- **`App/`, `WidgetExtension/`, `Shared/`** — a native WidgetKit desktop
  widget (Notification Center / desktop widget stack). Apple throttles
  system widget refresh, so this one updates every several minutes, not
  every couple of seconds — kept here in case you want a "real" system
  widget too, but it's not the fast-refresh option.

Both show the same core status: server online/offline, now playing (with
progress bars), recently added, per-library item counts, and how many
distinct users currently have an active stream.

The Übersicht version is the interactive one, and has grown a fair bit
past that baseline:

- **Recently Added is browsable**, not just a static list — each
  category (Movies, TV, Music, etc.) shows 4 posters at a time with
  `‹ ›` arrows to page through up to the last 20 added, and `▲ ▼`
  arrows to reorder the categories themselves. Posters added in the
  last 24 hours still get the glow.
- **Now Playing scrolls** once three or more people are streaming at
  once, with a "scroll for more" hint and pull-to-refresh from the top
  — and you can stop someone's stream directly from the widget. A
  playing tile glows and fades to black-and-white the instant it's
  paused.
- **Two update badges**: one for your Plex Media Server itself (reads
  the update Plex's own server already knows about), and one for
  StreamPulse — it checks this repo's latest GitHub release every few
  hours and shows a small "StreamPulse update available" badge you can
  click straight through to the release page. Both are quiet unless
  there's actually something new.
- **Sections (and Recently Added's categories) can be shown/hidden and
  reordered**, the background transparency has its own hover slider,
  and the whole widget can be resized by dragging its corner — all of
  it remembered locally, so it's exactly how you left it after a
  restart or a Mac reboot.
- A refresh/scan button on each library triggers a Plex library scan
  right from the widget, without opening Plex.

The WidgetKit version stays deliberately simpler — read-only status on
whatever schedule WidgetKit's system throttling allows, no paging,
reordering, or update badges. It's there for people who want a "real"
system widget rather than the fast-refresh, fully interactive one.

---
<img width="1106" height="1422" alt="screenshot" src="https://github.com/user-attachments/assets/347b538f-8c2b-4cf9-9d96-ff1d797dae84" />
---

## Übersicht widget (fast refresh) — recommended

1. **Install Übersicht**: https://tracesof.net/uebersicht/ — a free app
   that runs small JS/HTML "widgets" pinned to your desktop.

2. **Install jq** (used to parse Plex's API responses). Open Terminal:
   ```
   brew install jq
   ```
   If you don't have Homebrew: https://brew.sh

3. **Get the widget file** — pick whichever is easier:

   - **Quickest — download the release:** grab
     [`streampulse.widget.zip`](../../releases/latest) from the
     [Releases page](../../releases), unzip it, and you'll have a
     `streampulse.widget` folder containing `StreamPulse.jsx` — that's the
     same widget code, just packaged for a direct download without
     needing git. Skip to step 4 and use that folder instead of the
     file path shown there.
   - **Or clone the repo** and use `uebersicht/streampulse.example.jsx`
     — same code, useful if you also want the source handy for making
     your own edits. Copy it rather than editing in place (it's
     tracked in git, and your real Plex token shouldn't be).

4. **Put it in Übersicht's widgets folder**:
   - From the release download: drag the whole `streampulse.widget`
     folder into `~/Library/Application Support/Übersicht/widgets/`.
   - From a clone:
     ```
     cp "uebersicht/streampulse.example.jsx" "$HOME/Library/Application Support/Übersicht/widgets/streampulse.jsx"
     ```
   (Cmd+Shift+G in Finder is the fastest way to paste that path and
   jump straight there.)

5. **Sign in with Plex** — Übersicht picks up the widget automatically
   (if not, click its menu bar icon -> Refresh). It shows up near the
   top-left of your screen with a red "Sign in with Plex" prompt; click
   it, a browser tab opens to Plex's own sign-in page, and once you
   approve there the tab closes itself and the widget finds your server
   automatically — no token to copy or paste anywhere. (Menu bar icon
   -> "Enable click-through" toggles whether you can click/drag widgets
   at all.)

   Prefer not to use sign-in? You can still set your server info by
   hand instead — open the widget file in any text editor and fill in:
   ```js
   let PLEX_URL = "http://192.168.1.50:32400"; // your Plex server's local URL
   let PLEX_TOKEN = "YOUR_TOKEN_HERE";          // your X-Plex-Token
   ```
   To find your token: open the Plex web app, pick any item, "Get Info"
   -> "View XML", and copy the `X-Plex-Token=...` value from the URL bar.

6. Once signed in, drag the widget wherever you like on your desktop.
   Now Playing and system stats poll every couple of seconds from then
   on; recently added and library counts refresh every 5 minutes. No
   restart needed when your server comes back online or a stream starts.

### If it shows "Widget error" or won't sign in
- Confirm `jq` is installed: run `jq --version` in Terminal.
- If you set `PLEX_URL`/`PLEX_TOKEN` by hand, double check they're
  filled in correctly (no quotes missing, no trailing slash on the
  URL), and that your Mac can reach that URL: `curl
  http://<your-ip>:32400/identity` should return XML/JSON, not hang or
  error.
- If sign-in succeeds but the widget still shows "Plex Offline," make
  sure the Plex account you signed in with actually owns a server (an
  account with only shared/guest access to someone else's server won't
  have one to connect to — the widget will tell you this directly).

---

## WidgetKit version (native system widget, slower refresh)

The Swift files in `App/`, `WidgetExtension/`, and `Shared/` are a
complete native macOS widget — a tiny app to sanity-check your Plex
connection, and a widget extension that shows it on your desktop / in
Notification Center. Your Plex URL/token are hardcoded directly in
`Shared/PlexConfig.swift` (gitignored), the same approach as the
Übersicht widget — both targets read the same compiled-in constants
directly, so there's no App Group / shared container between them and
no extra signing capability to provision (App Groups under a free
Apple ID turned out to be unreliable — writes got silently blocked by
the sandbox no matter how the capability was reconfigured).
`project.yml` (via [XcodeGen](https://github.com/yonaskolb/XcodeGen))
turns the source files into a ready Xcode project without manually
clicking through target setup:

1. `brew install xcodegen` (one-time).
2. `cp Shared/PlexConfig.swift.example Shared/PlexConfig.swift`, then
   fill in your real Plex server URL and X-Plex-Token in that file
   (same as `uebersicht/streampulse.example.jsx` — to find your token: open the
   Plex web app, pick any item, "Get Info" → "View XML", copy the
   `X-Plex-Token=...` value from the URL bar).
3. From the repo root: `xcodegen generate` — creates
   `StreamPulse.xcodeproj` with both targets and entitlements already
   wired up.
4. Open `StreamPulse.xcodeproj` in Xcode. On **both** targets'
   *Signing & Capabilities* tab, set your own Team (any free personal
   Apple ID works for local use — no paid developer account needed).
5. Run the **StreamPulse** scheme — a small window opens with a Test
   Connection button, just to confirm `PlexConfig.swift` is right.
6. Right-click your desktop (or open Notification Center) → **Edit
   Widgets** → find **StreamPulse** → drag it onto your desktop, pick a
   size.

`project.yml` re-generates the project any time, so it's safe to delete
`StreamPulse.xcodeproj` and re-run `xcodegen generate` after editing the
Swift files or the spec — bundle IDs there are placeholder-style
(`com.example.streampulse`) and fine to leave as-is for local use.

Prefer to do it by hand in Xcode's UI instead? You can — create a new
Xcode project, add a Widget Extension target, and drop these files into
the right targets (`Shared/*.swift` belongs to both, including your
filled-in `PlexConfig.swift`).

---

## Notes

- **"Users streaming"** counts distinct users with an active Plex session
  right now — Plex doesn't expose a general "which Home users are
  currently online" API, so this is the closest honest signal.
- **Local network only by default.** Both versions talk directly to
  whatever `PLEX_URL` you give them (or, for the Übersicht version,
  whatever address sign-in resolves). If that's a local LAN address,
  they'll only show live data while your Mac is on the same network as
  the Plex server — away from home, expect "Offline". Signing in
  through the Übersicht version handles this for you automatically,
  switching between your local and remote address as needed; on a
  hand-filled `PLEX_URL` you'd use your Plex remote-access URL instead
  (`https://<your-id>.plex.direct:32400`-style).
- **Your data stays on your Mac.** StreamPulse talks directly to your
  own Plex server (and, only during sign-in, to plex.tv to complete
  the login) — there's no StreamPulse server in between collecting
  anything. Signing in stores your Plex token in a small file in your
  home folder (`~/.plex_widget_token` for the Übersicht version); if
  you fill in `PLEX_TOKEN` by hand instead, it lives only in that copy
  of the widget file. Either way nothing about your library, your
  viewing activity, or your server ever leaves your own machine, and
  you can sign out from the widget's About panel at any time to remove
  the stored token.

## License

MIT — see [LICENSE](LICENSE).
