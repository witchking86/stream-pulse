/*
 * StreamPulse — Übersicht widget (single widget, all-in-one)
 *
 * IMPORTANT — clicking anything in this widget (Stop button, poster
 * links, refresh buttons) requires Übersicht's own click-through to be
 * disabled for it to receive mouse events at all. Übersicht's docs:
 * "in order to receive click events you need to configure an
 * interaction shortcut and give Übersicht accessibility access."
 * Do this once:
 *   1. Click the Übersicht menu bar icon -> Settings/Preferences.
 *   2. Find "Interactivity" (wording varies by version) and set an
 *      interaction shortcut (a key you hold to click widgets), or
 *      enable "widgets are clickable".
 *   3. macOS will prompt for Accessibility permission — approve it, or
 *      go to System Settings -> Privacy & Security -> Accessibility and
 *      enable Übersicht there yourself.
 * Without this, every click on this widget silently does nothing — it's
 * not a bug in the code, Übersicht is passing your click straight
 * through to the desktop underneath.
 *
 * Polls your Plex server directly via fetch() using Übersicht's
 * init/dispatch/updateState pattern (no shell command spawned on a
 * timer — see the flicker note in earlier history if curious).
 *
 * - Now Playing (every active stream, poster art linking to the item in
 *   Plex Web, time remaining/total, finish time, stream speed,
 *   transcode/direct play status, progress bar, Stop button) refreshes
 *   every 2 seconds.
 * - Recently added (last 2, movies + TV + anything named "Screener*",
 *   never anything named "*game*") + library counts (with a per-library
 *   refresh button) refresh every 5 minutes.
 *
 * SETUP
 *  1. Install Übersicht: https://tracesof.net/uebersicht/
 *  2. PLEX_URL / PLEX_TOKEN below are already filled in for you.
 *  3. Copy this file into:
 *       ~/Library/Application Support/Übersicht/widgets/plex-status.jsx
 */

import { run } from "uebersicht";

// Starting/fallback address only — resolvePlexUrl() below automatically
// finds the best currently-reachable address (local LAN at home, remote
// or relay when away) via Plex's own resource directory, and re-checks
// it periodically so a changed public IP (e.g. a new ISP) or switching
// networks fixes itself without editing this file.
let PLEX_URL = "http://192.168.1.50:32400"; // optional — fine to leave as-is, see README
const SERVER_DISPLAY_NAME = null; // optional — leave null to show your server's real name

// ============================================================
//  >>> CHANGE THIS <<<  paste your own Plex token below
// ============================================================
const PLEX_TOKEN = "YOUR_TOKEN_HERE";
const PLEX_USERNAME = "";
function plexServerWebUrl() {
  return `${PLEX_URL}/web/index.html`;
}

// The widget's own version -- bump this (and widget.json) on release.
// Compared against the latest GitHub release tag so the widget can tell
// you when a newer StreamPulse is out.
const WIDGET_VERSION = "1.2";
const STREAMPULSE_REPO = "witchking86/stream-pulse";

export const refreshFrequency = false; // we drive our own polling in init()

export const initialState = {
  isOnline: false,
  avatarUrl: null,
  serverName: null,
  machineIdentifier: null,
  sessions: [],
  recentBySection: [],
  counts: [],
  confirmingSessionId: null,
  actionMessage: null,
  recentAddedCollapsed: false,
  nowPlayingCollapsed: false,
  nowPlayingAtBottom: false,
  nowPlayingAtTop: true,
  systemCollapsed: false,
  activityCollapsed: false,
  cpuProcessPct: null,
  memProcessPct: null,
  localBandwidthHistory: Array.from({ length: 60 }, (_, i) => ({ at: i - 60, v: 0 })),
  remoteBandwidthHistory: Array.from({ length: 60 }, (_, i) => ({ at: i - 60, v: 0 })),
  serverVersion: null,
  availableVersion: null,
  latestWidgetVersion: null,
  lastUpdatedAt: null,
  streamStartedAt: {},
  pausedAt: {},
  totalPlaysToday: 0,
  topTitle: null,
  topTitleCount: 0,
  topUser: null,
  topUserCount: 0,
  sectionOrder: ["nowPlaying", "recentAdded", "activity", "system"],
  hiddenSections: [],
  bandwidthOverlay: false,
  recentCategoryOrder: [],
  recentPosterOffset: {},
  hiddenRecentCategories: [],
};

// init() gets the real dispatch function from Übersicht; render() does
// not (Übersicht only passes render(props)). Stashing it here at module
// scope lets click handlers defined inside render() still dispatch
// state updates — same module, same closure.
let dispatchRef = null;

// --- Draggable positioning -------------------------------------------------
// Übersicht positions widgets via CSS on a wrapper we don't control, so the
// widget's own top/left CSS reads from custom properties on <html> instead —
// those cascade down regardless of DOM structure, and we can update them
// imperatively during a drag without forcing a full React re-render on every
// mousemove. Final position is persisted to a dotfile in $HOME so it
// survives Übersicht restarts.
const POSITION_FILE = "~/.plex_widget_position";
let dragOrigin = null; // { mouseX, mouseY, left, top } while dragging, else null

function currentPos() {
  const style = getComputedStyle(document.documentElement);
  const left = parseFloat(style.getPropertyValue("--plex-pos-left")) || 20;
  const top = parseFloat(style.getPropertyValue("--plex-pos-top")) || 44;
  return { left, top };
}

function setPos(left, top) {
  document.documentElement.style.setProperty("--plex-pos-left", `${left}px`);
  document.documentElement.style.setProperty("--plex-pos-top", `${top}px`);
}

function onDragMove(e) {
  if (!dragOrigin) return;
  const left = dragOrigin.left + (e.clientX - dragOrigin.mouseX);
  const top = dragOrigin.top + (e.clientY - dragOrigin.mouseY);
  setPos(left, top);
}

function onDragEnd() {
  if (!dragOrigin) return;
  dragOrigin = null;
  const { left, top } = currentPos();
  run(`echo "${Math.round(left)},${Math.round(top)}" > ${POSITION_FILE}`).catch(() => {});
}

function startDrag(e) {
  e.preventDefault();
  const { left, top } = currentPos();
  dragOrigin = { mouseX: e.clientX, mouseY: e.clientY, left, top };
}

if (typeof window !== "undefined") {
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeEnd);
}

async function loadSavedPosition() {
  try {
    const out = await run(`cat ${POSITION_FILE} 2>/dev/null`);
    const [left, top] = (out || "").trim().split(",").map(Number);
    if (Number.isFinite(left) && Number.isFinite(top)) setPos(left, top);
  } catch (e) {
    // no saved position yet — defaults from className apply
  }
}

// --- Resizable width -----------------------------------------------------
// Same imperative CSS-custom-property + dotfile pattern as the drag
// position above: className reads width from --plex-widget-width on
// <html>, a drag on the corner handle updates that property live without
// forcing a re-render, and the final value is persisted so it survives
// Übersicht restarts. Only width is draggable — height still flows from
// content (and the Now Playing scroll cap) same as before.
const WIDTH_FILE = "~/.plex_widget_width";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 380;
const MAX_WIDTH = 1000;
let resizeOrigin = null; // { mouseX, width } while resizing, else null

function currentWidth() {
  const style = getComputedStyle(document.documentElement);
  const v = parseFloat(style.getPropertyValue("--plex-widget-width"));
  return Number.isFinite(v) ? v : DEFAULT_WIDTH;
}

function setWidth(width) {
  const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
  document.documentElement.style.setProperty("--plex-widget-width", `${clamped}px`);
  return clamped;
}

function onResizeMove(e) {
  if (!resizeOrigin) return;
  setWidth(resizeOrigin.width + (e.clientX - resizeOrigin.mouseX));
}

function onResizeEnd() {
  if (!resizeOrigin) return;
  resizeOrigin = null;
  run(`echo "${Math.round(currentWidth())}" > ${WIDTH_FILE}`).catch(() => {});
}

function startResize(e) {
  e.preventDefault();
  e.stopPropagation();
  resizeOrigin = { mouseX: e.clientX, width: currentWidth() };
}

async function loadSavedWidth() {
  try {
    const out = await run(`cat ${WIDTH_FILE} 2>/dev/null`);
    const v = parseFloat((out || "").trim());
    if (Number.isFinite(v)) setWidth(v);
    else setWidth(DEFAULT_WIDTH);
  } catch (e) {
    setWidth(DEFAULT_WIDTH);
  }
}

// --- Pause timers ------------------------------------------------------
// pausedAt lives in React state (see the NOW_PLAYING reducer below), which
// on its own only remembers a pause's real start for as long as this one
// widget process stays alive — a manual Übersicht refresh/restart wipes
// React state and would otherwise restart every paused clock at 0, even
// though the stream itself has been sitting paused the whole time. So the
// timestamp a pause actually started at is also mirrored to a dotfile the
// moment it's set (and removed the moment the stream resumes), and reread
// on init — same durability pattern as position/section order/background
// opacity above, just keyed per session since more than one stream can be
// paused at once.
const PAUSED_AT_FILE = "~/.plex_widget_paused_at";

function persistPausedAt(pausedAt) {
  const serialized = Object.keys(pausedAt)
    .map((id) => `${id},${pausedAt[id]}`)
    .join(";");
  run(`echo "${serialized}" > ${PAUSED_AT_FILE}`).catch(() => {});
}

async function loadSavedPausedAt(dispatch) {
  try {
    const out = await run(`cat ${PAUSED_AT_FILE} 2>/dev/null`);
    const raw = (out || "").trim();
    if (!raw) return;
    const pausedAt = {};
    raw.split(";").forEach((entry) => {
      const [id, ts] = entry.split(",");
      if (id && Number.isFinite(Number(ts))) pausedAt[id] = Number(ts);
    });
    if (Object.keys(pausedAt).length) dispatch({ type: "PAUSED_AT_LOADED", pausedAt });
  } catch (e) {
    // no saved pause state yet
  }
}

// --- Background transparency slider ----------------------------------------
// Same imperative CSS-custom-property + dotfile pattern as the drag
// position above: a hover-revealed <input type="range"> in the header
// writes straight to --plex-bg-opacity (no React state / re-render
// needed for a value that only the background reads), and the final
// value is persisted so it survives Übersicht restarts. The slider's
// own 0-100 scale is "% transparent", which is the inverse of the CSS
// opacity value the background actually uses.
const BG_OPACITY_FILE = "~/.plex_widget_bg_opacity";
const DEFAULT_BG_OPACITY = 0; // 100% transparent — the slider's starting point

function currentBgOpacity() {
  const style = getComputedStyle(document.documentElement);
  const v = parseFloat(style.getPropertyValue("--plex-bg-opacity"));
  return Number.isFinite(v) ? v : DEFAULT_BG_OPACITY;
}

function setBgOpacity(opacity) {
  document.documentElement.style.setProperty("--plex-bg-opacity", String(opacity));
}

function onBgOpacitySliderChange(e) {
  const transparencyPct = Number(e.target.value);
  const opacity = Math.max(0, Math.min(1, 1 - transparencyPct / 100));
  setBgOpacity(opacity);
  run(`echo "${opacity}" > ${BG_OPACITY_FILE}`).catch(() => {});
  // Imperative DOM update, not React state — same reasoning as the drag
  // position above: this is a live-while-dragging value with nowhere
  // useful to round-trip through a dispatch/re-render cycle.
  const label = e.target.previousElementSibling;
  if (label) label.textContent = `${transparencyPct}%`;
}

async function loadSavedBgOpacity() {
  try {
    const out = await run(`cat ${BG_OPACITY_FILE} 2>/dev/null`);
    const v = parseFloat((out || "").trim());
    if (Number.isFinite(v)) setBgOpacity(v);
    else setBgOpacity(DEFAULT_BG_OPACITY);
  } catch (e) {
    setBgOpacity(DEFAULT_BG_OPACITY);
  }
}

// Same imperative CSS-custom-property + dotfile pattern as the opacity
// slider above — stored as an "r,g,b" triplet string so it can drop
// straight into rgba(var(--plex-bg-color-rgb), var(--plex-bg-opacity)).
const BG_COLOR_FILE = "~/.plex_widget_bg_color";
const DEFAULT_BG_COLOR = "18,18,20"; // the widget's original slate color
const BG_COLOR_PRESETS = [
  { label: "Slate", rgb: "18,18,20" },
  { label: "Black", rgb: "0,0,0" },
  { label: "Charcoal", rgb: "28,28,30" },
  { label: "Navy", rgb: "10,18,32" },
  { label: "Forest", rgb: "10,26,18" },
  { label: "Plum", rgb: "26,14,34" },
  { label: "Wine", rgb: "32,12,16" },
  { label: "Plex Gold", rgb: "38,28,10" },
];

function currentBgColor() {
  const style = getComputedStyle(document.documentElement);
  const v = style.getPropertyValue("--plex-bg-color-rgb").trim();
  return v || DEFAULT_BG_COLOR;
}

function setBgColor(rgb) {
  document.documentElement.style.setProperty("--plex-bg-color-rgb", rgb);
}

function onBgColorSwatchClick(e, rgb) {
  setBgColor(rgb);
  run(`echo "${rgb}" > ${BG_COLOR_FILE}`).catch(() => {});
  // Imperative selection-ring update, not React state — same reasoning
  // as the opacity slider's label update above.
  const group = e.currentTarget.parentElement;
  if (group) {
    Array.from(group.children).forEach((el) => el.classList.remove("bg-color-swatch-selected"));
  }
  e.currentTarget.classList.add("bg-color-swatch-selected");
}

async function loadSavedBgColor() {
  try {
    const out = await run(`cat ${BG_COLOR_FILE} 2>/dev/null`);
    const v = (out || "").trim();
    if (v) setBgColor(v);
    else setBgColor(DEFAULT_BG_COLOR);
  } catch (e) {
    setBgColor(DEFAULT_BG_COLOR);
  }
}

async function fetchJSON(url, extraHeaders) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...(extraHeaders || {}) } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// plex.tv's own device identity for this widget when talking to its v2
// API — the v2 endpoints (unlike the older per-server endpoints used
// everywhere else in this file) reject requests outright with a 400 if
// this header is missing. The value itself doesn't matter, it just has
// to be present and consistent.
const PLEX_CLIENT_IDENTIFIER = "plex-status-uebersicht-widget";

// Finds the best currently-reachable address for this server using
// Plex's own resource directory (the same info the official Plex apps
// use) instead of a hardcoded IP — this is what lets the widget work
// both at home and away, and keeps working automatically if your public
// IP changes (like after switching ISPs), since plex.tv always has
// whatever address the server most recently reported to it.
let lastPlexUrlResolveAt = 0;

async function testConnection(uri) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${uri}/identity?X-Plex-Token=${PLEX_TOKEN}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function resolvePlexUrl() {
  // Debounced so repeated failures (e.g. the 2s Now Playing poll) don't
  // hammer plex.tv — the periodic 60s re-check and manual triggers both
  // still get through since they're spaced further apart than this.
  if (Date.now() - lastPlexUrlResolveAt < 15000) return false;
  lastPlexUrlResolveAt = Date.now();

  const resources = await fetchJSON(
    `https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1`,
    {
      "X-Plex-Token": PLEX_TOKEN,
      "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
      "X-Plex-Product": "Plex Status Widget",
      "X-Plex-Version": "1.0",
    }
  );
  if (!Array.isArray(resources)) return false;

  const server = resources.find(
    (r) => r.provides && r.provides.includes("server") && r.owned && Array.isArray(r.connections) && r.connections.length
  );
  if (!server) return false;

  // Local (LAN) connections first — fastest, and avoids the NAT hairpin
  // issue — then remote direct connections, then Plex's relay (works
  // from anywhere but slower) as a last resort.
  const ranked = [...server.connections].sort((a, b) => {
    const rank = (c) => (c.local ? 0 : c.relay ? 2 : 1);
    return rank(a) - rank(b);
  });

  for (const conn of ranked) {
    const uri = (conn.uri || "").replace(/\/+$/, "");
    if (uri && (await testConnection(uri))) {
      PLEX_URL = uri;
      return true;
    }
  }
  return false;
}

function isRecentlyAddedWanted(sec) {
  const name = (sec.title || "").toLowerCase();
  return (
    sec.type === "movie" ||
    sec.type === "show" ||
    sec.type === "artist" ||
    name.includes("screener") ||
    name.includes("game") ||
    name.includes("music")
  );
}

// Fixed display order — used for both the Recently Added groups and the
// Library section pills: Movies, Screeners, TV Shows, Games, Music, then
// anything else.
function categoryRank(sec) {
  const name = (sec.title || "").toLowerCase();
  if (name.includes("screener")) return 1;
  if (name.includes("game")) return 3;
  if (name.includes("music") || sec.type === "artist") return 4;
  if (sec.type === "movie") return 0;
  if (sec.type === "show") return 2;
  return 5;
}

async function fetchSectionCount(key) {
  const countData = await fetchJSON(
    `${PLEX_URL}/library/sections/${key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=1&X-Plex-Token=${PLEX_TOKEN}`
  );
  return countData && countData.MediaContainer
    ? (countData.MediaContainer.totalSize ?? countData.MediaContainer.size ?? 0)
    : 0;
}

// TV libraries often add several episodes of the same season in one
// batch — showing each one as its own tile clutters the Recently Added
// row, so when more than one fetched episode belongs to the same
// show+season, they're collapsed into a single "Season N" tile instead
// of one tile per episode (a lone episode from a season still shows as
// just that episode). Fetches more raw items than we'll display for TV
// sections specifically, since grouping can collapse several fetched
// items down to one tile.
function groupRecentEpisodesBySeason(items) {
  const order = [];
  const bySeasonKey = new Map();
  items.forEach((item) => {
    if (item.type !== "episode" || item.grandparentRatingKey == null || item.parentIndex == null) {
      order.push({ item, count: 1 });
      return;
    }
    const seasonKey = `${item.grandparentRatingKey}:${item.parentIndex}`;
    if (bySeasonKey.has(seasonKey)) {
      bySeasonKey.get(seasonKey).count += 1;
    } else {
      const entry = { item, count: 1 };
      bySeasonKey.set(seasonKey, entry);
      order.push(entry);
    }
  });
  return order.map(({ item, count }) => (count > 1 ? { ...item, __seasonGroupCount: count } : item));
}

async function fetchSectionRecent(key, sectionType, sectionTitle) {
  const displayCount = 20; // fetched once per 5-minute poll; only 4 are ever shown at a time (see recentPosterOffset)

  if (sectionType !== "show") {
    const recentData = await fetchJSON(
      `${PLEX_URL}/library/sections/${key}/recentlyAdded?X-Plex-Container-Size=${displayCount}&X-Plex-Token=${PLEX_TOKEN}`
    );
    const items = (recentData && recentData.MediaContainer && recentData.MediaContainer.Metadata) || [];
    return items.slice(0, displayCount);
  }

  // Shows: a single bulk add (a whole season, or a whole series) can
  // dominate the raw "recently added" feed with dozens of episode
  // entries that all collapse down into just ONE season tile after
  // grouping — a fixed 20-item window was sometimes entirely made up of
  // that one season's episodes, leaving nothing else to group and no
  // room left to surface any other show added around the same time.
  // Widen the window progressively (capped) until there are enough
  // distinct season groups to fill the display count, or the server
  // genuinely has nothing more recent to offer.
  // Neither a bigger X-Plex-Container-Size nor manually walking
  // X-Plex-Container-Start moved the needle at all — a strong sign that
  // /recentlyAdded is a precomputed "hub" view that Plex doesn't apply
  // real pagination to (Container-Start gets silently ignored and it
  // just keeps handing back the same leading slice). Switching to the
  // plain library listing endpoint instead — /all?type=4 (episodes)
  // sorted by addedAt — is the same mechanism Plex Web itself uses to
  // browse a library page by page, so Container-Start actually means
  // something there. This only runs on the 5-minute library poll
  // against the local server, so several small requests are cheap.
  const PAGE_SIZE = 100;
  const MAX_TOTAL = 1500;
  let start = 0;
  let allItems = [];
  let grouped = [];
  while (start < MAX_TOTAL) {
    const recentData = await fetchJSON(
      `${PLEX_URL}/library/sections/${key}/all?type=4&sort=addedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}&X-Plex-Token=${PLEX_TOKEN}`
    );
    const page = (recentData && recentData.MediaContainer && recentData.MediaContainer.Metadata) || [];
    if (page.length === 0) break; // nothing more at all
    allItems = allItems.concat(page);
    grouped = groupRecentEpisodesBySeason(allItems);
    if (grouped.length >= displayCount) break;
    if (page.length < PAGE_SIZE) break; // this page came back short — really is the end of the list
    start += PAGE_SIZE;
  }
  return grouped.slice(0, displayCount);
}

async function pollNowPlaying(dispatch) {
  let identity = null;
  let identityError = null;
  try {
    const res = await fetch(`${PLEX_URL}/?X-Plex-Token=${PLEX_TOKEN}`, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      identityError = `server responded HTTP ${res.status}`;
    } else {
      identity = await res.json();
    }
  } catch (e) {
    identityError = `request failed (${e.message || "network error"})`;
  }

  // Shows up as a persistent banner for as long as the server is actually
  // unreachable — reported at "?" origin here so it doesn't get quietly
  // swallowed the way fetchJSON's null-on-any-failure normally would.
  if (identityError) {
    dispatch({ type: "ACTION_MESSAGE", message: `Can't reach server: ${identityError}` });
    setTimeout(() => dispatchRef && dispatchRef({ type: "ACTION_MESSAGE", message: null }), 8000);
    resolvePlexUrl(); // try switching to a reachable address (e.g. local <-> remote)
  }

  const sessionsData = await fetchJSON(`${PLEX_URL}/status/sessions?X-Plex-Token=${PLEX_TOKEN}`);
  const sessions = (sessionsData && sessionsData.MediaContainer && sessionsData.MediaContainer.Metadata) || [];

  dispatch({
    type: "NOW_PLAYING",
    isOnline: !!(identity && identity.MediaContainer && identity.MediaContainer.version),
    serverName: identity && identity.MediaContainer && identity.MediaContainer.friendlyName,
    serverVersion: identity && identity.MediaContainer && identity.MediaContainer.version,
    machineIdentifier: identity && identity.MediaContainer && identity.MediaContainer.machineIdentifier,
    sessions,
  });
}

// Reads whatever update info the server already knows about from its own
// periodic checks — this is a plain GET, it doesn't force a new check.
async function pollUpdateStatus(dispatch) {
  const data = await fetchJSON(`${PLEX_URL}/updater/status?X-Plex-Token=${PLEX_TOKEN}`);
  const releases = (data && data.MediaContainer && data.MediaContainer.Release) || [];
  const availableVersion = releases.length ? releases[0].version : null;
  dispatch({ type: "UPDATE_STATUS", availableVersion });
}

// Numeric compare -- "1.10" is newer than "1.2", unlike a plain string
// sort (which would call "1.10" older). Missing/malformed segments
// count as 0.
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const a = String(latest).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(current).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Checks GitHub for the latest published StreamPulse release. This is a
// plain unauthenticated GET against the public API -- no token needed --
// so it works even if your Plex server is offline or unreachable.
async function pollWidgetUpdateStatus(dispatch) {
  const data = await fetchJSON(`https://api.github.com/repos/${STREAMPULSE_REPO}/releases/latest`);
  const tag = data && data.tag_name;
  // Tags have looked like "v1.2" and "streampulse_v1.2" -- strip
  // whatever non-digit prefix is there rather than assuming one form.
  const stripped = tag ? tag.replace(/^[^0-9]*/, "") : null;
  const latestWidgetVersion = stripped || null;
  dispatch({ type: "WIDGET_UPDATE_STATUS", latestWidgetVersion });
}

// Server-wide watch activity (all users, matching how Now Playing already
// isn't scoped to just you) — total plays today, plus today's top title
// and top user by play count.
async function pollHistory(dispatch) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodaySec = Math.floor(startOfToday.getTime() / 1000);

  // The history response itself doesn't embed an account list (unlike
  // /status/sessions, which nests a full User object per session) — it
  // only stamps each entry with a numeric accountID, so the id->name
  // mapping has to come from a separate call to the server's own
  // /accounts endpoint.
  const [data, accountsData] = await Promise.all([
    fetchJSON(
      `${PLEX_URL}/status/sessions/history/all?sort=viewedAt:desc&viewedAt%3E=${startOfTodaySec}&X-Plex-Token=${PLEX_TOKEN}`
    ),
    fetchJSON(`${PLEX_URL}/accounts?X-Plex-Token=${PLEX_TOKEN}`),
  ]);
  const entries = (data && data.MediaContainer && data.MediaContainer.Metadata) || [];
  const accounts = (accountsData && accountsData.MediaContainer && accountsData.MediaContainer.Account) || [];
  const accountNameById = {};
  accounts.forEach((a) => {
    accountNameById[a.id] = a.name || a.title || "Unknown";
  });

  const totalPlaysToday = entries.length;

  const titleCounts = {};
  entries.forEach((e) => {
    const label = e.grandparentTitle || e.title || "Unknown";
    titleCounts[label] = (titleCounts[label] || 0) + 1;
  });
  let topTitle = null;
  let topTitleCount = 0;
  Object.keys(titleCounts).forEach((label) => {
    if (titleCounts[label] > topTitleCount) {
      topTitle = label;
      topTitleCount = titleCounts[label];
    }
  });

  const userCounts = {};
  entries.forEach((e) => {
    // Prefer the /accounts id->name lookup; fall back to a nested User
    // object if a future Plex version ever starts embedding one here.
    const label = accountNameById[e.accountID] || (e.User && e.User.title) || "Unknown";
    userCounts[label] = (userCounts[label] || 0) + 1;
  });
  let topUser = null;
  let topUserCount = 0;
  Object.keys(userCounts).forEach((label) => {
    if (userCounts[label] > topUserCount) {
      topUser = label;
      topUserCount = userCounts[label];
    }
  });

  // Plex's history only records an item once it crosses ~90% played, not
  // live minutes-so-far — so 0 plays can be correct (nothing's finished
  // today yet) rather than a bug. Surface what the query actually found
  // so that's distinguishable from the request itself failing.
  let diag = null;
  if (!data) {
    diag = "Activity: history request failed";
  } else if (entries.length === 0) {
    diag = "Activity: no plays recorded yet today (Plex only counts finished items)";
  }
  if (diag) {
    dispatch({ type: "ACTION_MESSAGE", message: diag });
    setTimeout(() => dispatchRef && dispatchRef({ type: "ACTION_MESSAGE", message: null }), 10000);
  }

  dispatch({ type: "HISTORY", totalPlaysToday, topTitle, topTitleCount, topUser, topUserCount });
}

async function pollLibrary(dispatch) {
  const sectionsData = await fetchJSON(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`);
  const sections = (sectionsData && sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) || [];

  const counts = [];
  const recentBySection = [];

  for (const sec of sections) {
    const count = await fetchSectionCount(sec.key);
    counts.push({ key: sec.key, title: sec.title, type: sec.type, count, refreshing: !!sec.refreshing });

    if (isRecentlyAddedWanted(sec)) {
      const items = await fetchSectionRecent(sec.key, sec.type, sec.title);
      recentBySection.push({ key: sec.key, title: sec.title, rank: categoryRank(sec), items });
    }
  }

  recentBySection.sort((a, b) => a.rank - b.rank);
  counts.sort((a, b) => categoryRank(a) - categoryRank(b));

  dispatch({ type: "LIBRARY", recentBySection, counts });
}

// A fast, cheap companion to pollLibrary — just the "is this section
// currently being scanned" flag, so the Library pill can light up
// promptly (Plex orange) for any scan, whether triggered from this
// widget's own refresh button or from elsewhere (Plex Web, a schedule).
// Deliberately skips the count/recently-added fetches pollLibrary does,
// since those are heavier and don't need to run every few seconds.
async function pollLibraryScanStatus(dispatch) {
  const sectionsData = await fetchJSON(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`);
  const sections = (sectionsData && sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) || [];
  const refreshingByKey = {};
  sections.forEach((sec) => {
    refreshingByKey[sec.key] = !!sec.refreshing;
  });
  dispatch({ type: "LIBRARY_SCAN_STATUS", refreshingByKey });
}

// Triggers an actual Plex Media Server library scan for this section
// (equivalent to "Scan Library Files" in Plex Web), then re-pulls the
// count + recently added once the scan request is acknowledged. Note
// the scan itself runs async on the server — new items may take a
// while to actually appear depending on library size.
async function refreshSection(sec) {
  if (!dispatchRef) return;
  // Turn the pill orange the instant you click, rather than waiting on
  // any network round-trip — guarantees you see it react immediately
  // regardless of how quickly Plex's own "refreshing" flag updates.
  dispatchRef({ type: "SCAN_STARTED", key: sec.key });
  dispatchRef({ type: "ACTION_MESSAGE", message: `Scanning ${sec.title}…` });
  try {
    const res = await fetch(`${PLEX_URL}/library/sections/${sec.key}/refresh?X-Plex-Token=${PLEX_TOKEN}`);
    if (!res.ok) {
      dispatchRef({ type: "ACTION_MESSAGE", message: `Scan failed (HTTP ${res.status}) for ${sec.title}` });
      setTimeout(() => dispatchRef && dispatchRef({ type: "ACTION_MESSAGE", message: null }), 4000);
      return;
    }
    const count = await fetchSectionCount(sec.key);
    const items = isRecentlyAddedWanted(sec) ? await fetchSectionRecent(sec.key, sec.type, sec.title) : null;
    dispatchRef({ type: "SECTION_REFRESHED", key: sec.key, count, items });
    // Diagnostic: show exactly what Plex itself reports for "refreshing"
    // right after triggering, so a mismatch between what Plex says and
    // what the pill shows is visible instead of silent.
    const checkData = await fetchJSON(`${PLEX_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`);
    const checkSections = (checkData && checkData.MediaContainer && checkData.MediaContainer.Directory) || [];
    const matched = checkSections.find((s) => String(s.key) === String(sec.key));
    const refreshingReported = matched ? matched.refreshing : "section not found";
    dispatchRef({ type: "ACTION_MESSAGE", message: `Scan triggered for ${sec.title} (Plex reports refreshing: ${refreshingReported})` });
  } catch (e) {
    dispatchRef({ type: "ACTION_MESSAGE", message: `Scan failed: ${e.message}` });
  }
  setTimeout(() => dispatchRef && dispatchRef({ type: "ACTION_MESSAGE", message: null }), 8000);
}


// Stops a session. sessionId is Session.id from a /status/sessions entry
// (NOT sessionKey — Plex uses a separate id for the terminate endpoint).
async function stopSession(sessionId, title) {
  if (!sessionId || !dispatchRef) return;
  dispatchRef({ type: "ACTION_MESSAGE", message: `Stopping "${title}"…` });
  try {
    const res = await fetch(
      `${PLEX_URL}/status/sessions/terminate?sessionId=${encodeURIComponent(sessionId)}&reason=${encodeURIComponent("Stopped from Plex Status widget")}&X-Plex-Token=${PLEX_TOKEN}`
    );
    dispatchRef({
      type: "ACTION_MESSAGE",
      message: res.ok ? `Stopped "${title}"` : `Stop failed (HTTP ${res.status}) — your token may not have permission to stop streams`,
    });
  } catch (e) {
    dispatchRef({ type: "ACTION_MESSAGE", message: `Stop failed: ${e.message}` });
  }
  dispatchRef({ type: "CONFIRM_STOP", sessionId: null });
  setTimeout(() => dispatchRef && dispatchRef({ type: "ACTION_MESSAGE", message: null }), 5000);
}

// Opens a URL in your default browser via macOS `open`, bypassing the
// widget's own (non-navigable) webview.
function openExternal(url) {
  if (!url) return;
  run(`open "${url}"`).catch(() => {});
}

// Your account's avatar, fetched once from this Plex server's own
// /accounts list (Home/managed users) rather than plex.tv, so it stays
// consistent with everything else this widget already talks to.
async function pollAccount(dispatch) {
  // Your actual plex.tv account avatar, looked up directly by token —
  // this is your real profile picture, unlike the local server's
  // Home-user record (which only has a thumb if you set a Plex Home
  // profile photo, separate from your plex.tv avatar).
  const me = await fetchJSON(`https://plex.tv/api/v2/user?X-Plex-Token=${PLEX_TOKEN}`);
  dispatch({ type: "ACCOUNT", avatarUrl: (me && me.thumb) || null });
}

// Server CPU/memory (from the same live stats Plex Web's own "Resources"
// dashboard uses) and total recent bandwidth across all streams/devices.
//
// Plex's /statistics/bandwidth entries are stamped with their own real
// "at" (epoch seconds) — accumulating by that real timestamp, instead of
// just taking "whatever's latest" once per local poll, is what actually
// guarantees each bar is a real, distinct second: it no longer matters
// whether our 1s poll interval and Plex's own internal write cadence
// ever drift out of lockstep with each other. Kept outside React state
// (module scope) since it's an accumulation buffer, not render data.
let bandwidthByAt = {};

async function pollSystemStats(dispatch) {
  const [resData, bwData] = await Promise.all([
    fetchJSON(`${PLEX_URL}/statistics/resources?timespan=6&X-Plex-Token=${PLEX_TOKEN}`),
    fetchJSON(`${PLEX_URL}/statistics/bandwidth?timespan=6&X-Plex-Token=${PLEX_TOKEN}`),
  ]);

  const resources = (resData && resData.MediaContainer && resData.MediaContainer.StatisticsResources) || [];
  const latestRes = resources[resources.length - 1];
  const cpuProcessPct = latestRes ? latestRes.processCpuUtilization : null;
  const memProcessPct = latestRes ? latestRes.processMemoryUtilization : null;

  const bandwidthEntries = (bwData && bwData.MediaContainer && bwData.MediaContainer.StatisticsBandwidth) || [];
  // Sum this poll's own entries per-second first (Plex can report more
  // than one entry for the same second — e.g. separate devices — and
  // those genuinely need to be added together)...
  const thisPollByAt = {};
  bandwidthEntries.forEach((b) => {
    const at = b.at || 0;
    if (!thisPollByAt[at]) thisPollByAt[at] = { local: 0, remote: 0 };
    if (b.lan) thisPollByAt[at].local += b.bytes || 0;
    else thisPollByAt[at].remote += b.bytes || 0;
  });
  // ...then OVERWRITE the persisted value for that second, never add to
  // it. Plex re-sends the same recent seconds on every poll, so summing
  // onto the running total here would make every bucket climb forever
  // and never reflect a real decrease.
  Object.keys(thisPollByAt).forEach((at) => {
    bandwidthByAt[at] = thisPollByAt[at];
  });

  const knownAts = Object.keys(bandwidthByAt).map(Number).sort((a, b) => a - b);
  // Anchored to real wall-clock time, not to whatever Plex's data itself
  // says is most recent — Plex doesn't post a fresh bucket every literal
  // second, so using its own latest timestamp as the window's right edge
  // meant the window could jump by more than one column in a single
  // update whenever Plex's reporting lagged, instead of always sliding
  // exactly one column per second. Any second wall-clock has already
  // passed but Plex hasn't reported yet just shows 0 for now and
  // corrects itself in place once the real data arrives.
  const nowSec = Math.floor(Date.now() / 1000);
  // Prune anything we'll never display again so this doesn't grow forever.
  knownAts.forEach((at) => {
    if (at < nowSec - 90) delete bandwidthByAt[at];
  });

  // Plex doesn't always post a fresh bucket for every real second — when
  // there's a gap between two reported seconds, that bucket's bytes
  // actually cover the whole gap it just closed, not only its own
  // single labeled second. Dividing by 1 second regardless (the old
  // behavior) dumped a multi-second total onto one bar and left the
  // rest of the gap at 0, which is exactly the "either ~0 or pegged
  // near max" pattern. Spreading each bucket's rate evenly across the
  // real gap it spans fixes that.
  const recentAts = knownAts.filter((at) => at >= nowSec - 90);
  const secondRate = {};
  recentAts.forEach((at, idx) => {
    const prevAt = idx > 0 ? recentAts[idx - 1] : at - 1;
    const span = Math.max(1, at - prevAt);
    const bucket = bandwidthByAt[at];
    const localMbps = (bucket.local * 8) / 1000000 / span;
    const remoteMbps = (bucket.remote * 8) / 1000000 / span;
    for (let s = at - span + 1; s <= at; s++) {
      secondRate[s] = { local: localMbps, remote: remoteMbps };
    }
  });

  const localHistory = [];
  const remoteHistory = [];
  for (let secondsAgo = 59; secondsAgo >= 0; secondsAgo--) {
    const at = nowSec - secondsAgo;
    const rate = secondRate[at];
    localHistory.push({ at, v: rate ? rate.local : 0 });
    remoteHistory.push({ at, v: rate ? rate.remote : 0 });
  }

  dispatch({ type: "SYSTEM_STATS", cpuProcessPct, memProcessPct, localHistory, remoteHistory });
}

export const init = (dispatch) => {
  dispatchRef = dispatch;
  loadSavedPosition();
  loadSavedWidth();
  loadSavedBgOpacity();
  loadSavedBgColor();
  loadSavedSectionOrder(dispatch);
  loadSavedHiddenSections(dispatch);
  loadSavedCollapsedSections(dispatch);
  loadSavedBandwidthOverlay(dispatch);
  loadSavedRecentCategoryOrder(dispatch);
  loadSavedHiddenRecentCategories(dispatch);
  loadSavedPausedAt(dispatch);

  // Resolve the best reachable address first so the very first round of
  // polls already hits it, then kick everything else off.
  resolvePlexUrl().finally(() => {
    pollNowPlaying(dispatch);
    pollLibrary(dispatch);
    pollAccount(dispatch);
    pollSystemStats(dispatch);
    pollUpdateStatus(dispatch);
    pollHistory(dispatch);
    pollLibraryScanStatus(dispatch);
  });
  pollWidgetUpdateStatus(dispatch);

  setInterval(() => pollNowPlaying(dispatch), 2000);
  setInterval(() => pollLibrary(dispatch), 5 * 60 * 1000);
  setInterval(() => pollSystemStats(dispatch), 1000);
  setInterval(() => pollUpdateStatus(dispatch), 30 * 60 * 1000);
  setInterval(() => pollHistory(dispatch), 5 * 60 * 1000);
  setInterval(() => pollLibraryScanStatus(dispatch), 3000);
  // The widget itself doesn't release often -- a few times a day is
  // plenty, so check every 6 hours rather than hammering GitHub's API.
  setInterval(() => pollWidgetUpdateStatus(dispatch), 6 * 60 * 60 * 1000);
  // Re-check periodically so leaving/returning home, or your public IP
  // changing, recovers on its own without reopening the widget.
  setInterval(() => resolvePlexUrl(), 60 * 1000);
};

export const updateState = (event, previousState) => {
  if (event.type === "NOW_PLAYING") {
    const now = Date.now();
    const currentIds = new Set(event.sessions.map((s) => s.Session && s.Session.id).filter(Boolean));
    const streamStartedAt = { ...previousState.streamStartedAt };
    currentIds.forEach((id) => {
      if (!(id in streamStartedAt)) streamStartedAt[id] = now;
    });
    Object.keys(streamStartedAt).forEach((id) => {
      if (!currentIds.has(id) || now - streamStartedAt[id] > 6000) delete streamStartedAt[id];
    });

    const pausedAt = { ...previousState.pausedAt };
    let pausedAtChanged = false;
    event.sessions.forEach((s) => {
      const id = s.Session && s.Session.id;
      if (!id) return;
      if (s.Player && s.Player.state === "paused") {
        if (!(id in pausedAt)) {
          pausedAt[id] = now;
          pausedAtChanged = true;
        }
      } else if (id in pausedAt) {
        delete pausedAt[id];
        pausedAtChanged = true;
      }
    });
    Object.keys(pausedAt).forEach((id) => {
      if (!currentIds.has(id)) {
        delete pausedAt[id];
        pausedAtChanged = true;
      }
    });
    // Mirror to disk only when something actually changed — a pause
    // started, resumed, or its session ended — not on every 2s poll.
    if (pausedAtChanged) persistPausedAt(pausedAt);

    return {
      ...previousState,
      isOnline: event.isOnline,
      serverName: event.serverName,
      serverVersion: event.serverVersion,
      machineIdentifier: event.machineIdentifier,
      sessions: event.sessions,
      streamStartedAt,
      pausedAt,
      lastUpdatedAt: now,
    };
  }
  if (event.type === "PAUSED_AT_LOADED") {
    // The disk copy holds the TRUE original pause start — if a poll
    // already raced ahead and stamped "now" for a session that turns out
    // to have been paused before this widget process even started, the
    // loaded timestamp should win over that guess, not the other way
    // around.
    return { ...previousState, pausedAt: { ...previousState.pausedAt, ...event.pausedAt } };
  }
  if (event.type === "UPDATE_STATUS") {
    return { ...previousState, availableVersion: event.availableVersion };
  }
  if (event.type === "WIDGET_UPDATE_STATUS") {
    return { ...previousState, latestWidgetVersion: event.latestWidgetVersion };
  }
  if (event.type === "HIDDEN_SECTIONS") {
    return { ...previousState, hiddenSections: event.hiddenSections };
  }
  if (event.type === "HIDDEN_RECENT_CATEGORIES") {
    return { ...previousState, hiddenRecentCategories: event.hiddenRecentCategories };
  }
  if (event.type === "HISTORY") {
    return {
      ...previousState,
      totalPlaysToday: event.totalPlaysToday,
      topTitle: event.topTitle,
      topTitleCount: event.topTitleCount,
      topUser: event.topUser,
      topUserCount: event.topUserCount,
    };
  }
  if (event.type === "TOGGLE_ACTIVITY") {
    return { ...previousState, activityCollapsed: !previousState.activityCollapsed };
  }
  if (event.type === "SECTION_ORDER") {
    return { ...previousState, sectionOrder: event.order };
  }
  if (event.type === "RECENT_CATEGORY_ORDER") {
    return { ...previousState, recentCategoryOrder: event.order };
  }
  if (event.type === "RECENT_POSTER_PAGE") {
    return { ...previousState, recentPosterOffset: { ...previousState.recentPosterOffset, [event.key]: event.offset } };
  }
  if (event.type === "LIBRARY") {
    return { ...previousState, recentBySection: event.recentBySection, counts: event.counts };
  }
  if (event.type === "LIBRARY_SCAN_STATUS") {
    const counts = previousState.counts.map((c) => ({
      ...c,
      refreshing: event.refreshingByKey[c.key] != null ? event.refreshingByKey[c.key] : c.refreshing,
    }));
    return { ...previousState, counts };
  }
  if (event.type === "SCAN_STARTED") {
    const counts = previousState.counts.map((c) => (c.key === event.key ? { ...c, refreshing: true } : c));
    return { ...previousState, counts };
  }
  if (event.type === "SECTION_REFRESHED") {
    const counts = previousState.counts.map((c) => (c.key === event.key ? { ...c, count: event.count, refreshing: true } : c));
    const recentBySection = event.items
      ? previousState.recentBySection.map((r) => (r.key === event.key ? { ...r, items: event.items } : r))
      : previousState.recentBySection;
    return { ...previousState, counts, recentBySection };
  }
  if (event.type === "CONFIRM_STOP") {
    return { ...previousState, confirmingSessionId: event.sessionId };
  }
  if (event.type === "ACTION_MESSAGE") {
    return { ...previousState, actionMessage: event.message };
  }
  if (event.type === "TOGGLE_RECENT") {
    return { ...previousState, recentAddedCollapsed: !previousState.recentAddedCollapsed };
  }
  if (event.type === "TOGGLE_NOW_PLAYING") {
    return { ...previousState, nowPlayingCollapsed: !previousState.nowPlayingCollapsed };
  }
  if (event.type === "NOW_PLAYING_SCROLL_STATE") {
    return { ...previousState, nowPlayingAtBottom: event.atBottom, nowPlayingAtTop: event.atTop };
  }
  if (event.type === "SYSTEM_STATS") {
    return {
      ...previousState,
      cpuProcessPct: event.cpuProcessPct,
      memProcessPct: event.memProcessPct,
      localBandwidthHistory: event.localHistory,
      remoteBandwidthHistory: event.remoteHistory,
    };
  }
  if (event.type === "TOGGLE_SYSTEM") {
    return { ...previousState, systemCollapsed: !previousState.systemCollapsed };
  }
  // (persistence for this toggle lives with the other dotfile-backed
  // settings — see BANDWIDTH_OVERLAY_FILE below)
  if (event.type === "TOGGLE_BANDWIDTH_OVERLAY") {
    return { ...previousState, bandwidthOverlay: !previousState.bandwidthOverlay };
  }
  if (event.type === "ACCOUNT") {
    return { ...previousState, avatarUrl: event.avatarUrl };
  }
  return previousState;
};

export const className = `
  top: var(--plex-pos-top, 44px);
  left: var(--plex-pos-left, 20px);
  width: var(--plex-widget-width, 480px);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  color: #f2f2f2;
  background: rgba(var(--plex-bg-color-rgb, 18, 18, 20), var(--plex-bg-opacity, 0));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.35);

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    display: flex;
    align-items: center;
  }

  .server-title {
    color: #E5A00D;
  }

  .row-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .drag-handle {
    cursor: move;
    opacity: 0;
    transition: opacity 0.15s ease;
    font-size: 14px;
    line-height: 1;
    user-select: none;
  }

  .widget-root:hover .drag-handle {
    opacity: 0.45;
  }

  .resize-handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 0.15s ease;
    font-size: 11px;
    line-height: 1;
    user-select: none;
  }

  .widget-root:hover .resize-handle {
    opacity: 0.35;
  }

  .resize-handle:hover {
    opacity: 0.7;
  }

  .drag-handle:hover {
    opacity: 0.9;
  }

  .widget-controls {
    margin-top: 6px;
  }

  .bottom-controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 12px;
  }

  .bg-color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: 4px;
    height: 12px;
  }

  .bg-color-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .bg-color-label {
    font-size: 9px;
    color: rgba(255,255,255,0.4);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    white-space: nowrap;
    min-width: 78px;
    text-align: right;
  }

  .bg-color-swatches {
    display: flex;
    align-items: center;
    gap: 5px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .bg-color-swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
    box-sizing: border-box;
    border: 1px solid rgba(255,255,255,0.25);
    cursor: pointer;
  }

  .bg-color-swatch:hover {
    border-color: rgba(255,255,255,0.6);
  }

  .bg-color-swatch-selected {
    border-color: #E5A00D;
    border-width: 2px;
  }

  .hidden-sections-group {
    display: flex;
    align-items: center;
    gap: 6px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .bg-opacity-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .bg-opacity-label {
    font-size: 9px;
    color: rgba(255,255,255,0.4);
    opacity: 0;
    transition: opacity 0.15s ease;
    white-space: nowrap;
    min-width: 78px;
    text-align: right;
  }

  .bg-opacity-value {
    font-size: 9px;
    color: rgba(255,255,255,0.55);
    opacity: 0;
    transition: opacity 0.15s ease;
    min-width: 26px;
    text-align: right;
  }

  .bg-opacity-slider {
    width: 100px;
    height: 12px;
    margin: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    cursor: pointer;
    -webkit-appearance: none;
    background: transparent;
  }

  .widget-controls:hover .bg-opacity-slider,
  .widget-controls:hover .bg-opacity-value,
  .widget-controls:hover .bg-opacity-label,
  .widget-controls:hover .hidden-sections-group,
  .widget-controls:hover .bg-color-label,
  .widget-controls:hover .bg-color-swatches {
    opacity: 1;
    pointer-events: auto;
  }

  .bg-opacity-slider::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.18);
  }

  .bg-opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #E5A00D;
    margin-top: -3.5px;
    cursor: pointer;
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    margin-right: 6px;
    cursor: pointer;
    flex-shrink: 0;
    background: rgb(37, 37, 39);
  }

  /* Static Plex-orange glow around the avatar while the server is online —
     no pulsing here (unlike Now Playing/newly-added posters), since this
     reflects a steady, ongoing state rather than a transient event. */
  .avatar-online {
    box-shadow: 0 0 4px 1px rgba(229, 160, 13, 0.6), 0 0 10px 2px rgba(229, 160, 13, 0.45);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    display: inline-block;
  }

  .online { background: #35d07f; }
  .offline { background: #ff5f56; }

  .bottom-error-message {
    font-size: 9px;
    color: #E5A00D;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .bottom-error-message.visible {
    opacity: 1;
  }

  .row-backdrop-art {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    filter: blur(2px) brightness(0.5);
    opacity: 0.55;
    pointer-events: none;
    z-index: 0;
    transition: filter 0.4s ease;
  }

  /* Caps Now Playing at roughly 4 tiles tall — with 4 or fewer streams
     the container's natural height stays under this, so it has no
     effect and the widget still shrinks/grows with the stream count
     like before; past 4 it stops growing and becomes scrollable
     instead. No overflow-x rule here on purpose — clipping horizontally
     is what cropped tile content last time; only the vertical axis is
     constrained. The scrollbar itself is hidden (0 width) since a
     trackpad/mouse-wheel scroll works on this element with or without
     a visible bar — there's just nothing to look at. */
  .widget-root {
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 0;
  }

  /* Sits above the outer card's own background fill (so it stays
     visible no matter how opaque the background slider is set) but
     behind every real piece of content, thanks to .widget-root above
     being its own stacking context. */
  .header-logo-icon {
    width: 35px;
    height: auto;
    opacity: 0.7;
    display: block;
  }

  /* Absolutely positioned (not in normal flow) in the same top-right
     spot the logo watermark used to sit — so relocating it here doesn't
     push Now Playing, or anything else below the header, down at all. */
  .header-streaming-info {
    position: absolute;
    top: 46px;
    right: 0;
    white-space: nowrap;
    pointer-events: none;
  }

  /* Now Playing (.section-now-playing below) is the one section allowed
     to flex/shrink — its own scroll cap (see .now-playing-scroll) is
     what actually limits it to 2 tiles, this just keeps the other
     sections from being squeezed by anything. */
  .widget-root > * {
    flex-shrink: 0;
  }

  .section-now-playing {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .section-now-playing > .section-label {
    margin-top: 4px;
    /* .now-playing-scroll below has margin-top: -10px (it pulls itself
       up to cancel its own top padding, added for the glow effect) — the
       base 4px bottom margin here wasn't enough to absorb that pull, so
       the tiles were actually overlapping "Now Playing" by about 6px.
       20px leaves a clean ~4px gap after that -16px pull is applied. */
    margin-bottom: 20px;
  }

  .now-playing-scroll {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    /* Setting overflow-y alone still makes the browser treat overflow-x
       (and, per the same rule, the top/bottom edges of the box) as
       non-visible too, which was clipping the active-glow box-shadow —
       it paints a few pixels outside each row's own box on every side,
       including above the very first tile. Padding on all sides gives
       that glow room to render, and the matching negative margin pulls
       the container back out so the tiles still line up with the
       widget's actual edges instead of sitting inset. */
    /* Vertical padding must match BUFFER in
       measureNowPlayingCapHeight/onNowPlayingScroll exactly — that JS
       math only reserves BUFFER px of "extra" room beyond the tiles' own
       natural height, so if this padding reserves more than that, the
       actual content area ends up shorter than the tiles need just for
       their own boxes, clipping them outright (not just their glow).
       Shrunk from 16px alongside BUFFER's drop to 8px, to keep a hidden
       neighbor row's glow from bleeding into view.
       Horizontal padding has no such constraint (there's no side-by-side
       tile to worry about) -- 8px was cutting the glow's fade-out tail
       off a few px early at each tile's left/right edge, so it's sized
       to match .widget-root's own 18px side padding instead, which is
       exactly how much room actually exists before the glow would reach
       the widget's real edge. */
    padding: 8px 18px;
    margin: -8px -18px 0 -18px;
  }

  .now-playing-scroll::-webkit-scrollbar {
    width: 0;
    background: transparent;
  }

  /* Shown only when there are 3+ concurrent streams — enough that the
     2-tile scroll cap above guarantees at least one is offscreen. Sits
     as a normal in-flow row right after .now-playing-scroll, so it's
     outside the scroll cutoff — below the clipped edge, never overlaid
     on top of the last visible tile. flex-shrink: 0 keeps it from being
     squeezed as the scroll pane above it grows/shrinks. */
  .scroll-more-hint {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 0 0 0;
    margin-top: 2px;
    font-size: 9px;
    letter-spacing: 0.02em;
    color: #E5A00D;
  }

  .scroll-more-arrow {
    display: inline-block;
    animation: scroll-more-bounce 1.4s ease-in-out infinite;
  }

  @keyframes scroll-more-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(3px); }
  }

  .section-divider {
    flex-shrink: 0;
    height: 1px;
    margin-top: 12px;
    background: rgba(229, 160, 13, 0.25);
  }

  .media-row-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: filter 0.4s ease;
  }

  .media-row.row-paused .poster-large {
    filter: grayscale(1);
  }

  .media-row.row-paused .row-backdrop-art {
    filter: blur(2px) brightness(0.5) grayscale(1);
  }

  /* Targeted instead of a blanket filter on the whole row: grayscale
     the title and the plain info lines, but leave the paused-state
     label, the pause timer, and the direct-play/transcode badges in
     their own colors — a filter on a shared ancestor would have washed
     those out too, since it applies to everything painted beneath it. */
  .media-row.row-paused .item-title {
    filter: grayscale(1);
  }

  .media-row.row-paused .user-name {
    filter: grayscale(1);
  }

  .media-row.row-paused .media-body > .muted:not(.status-line) {
    filter: grayscale(1);
  }

  .pause-timer {
    font-weight: 700;
    color: #ff5f56;
  }

  .pause-timer-flash {
    animation: pause-timer-flash 1s ease-in-out infinite;
  }

  @keyframes pause-timer-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  .server-version-row {
    font-size: 10px;
    min-height: 14px;
    margin: -4px 0 2px;
  }

  .update-badge {
    display: inline-block;
    background: rgb(56, 44, 19);
    color: #E5A00D;
    border-radius: 8px;
    padding: 1px 6px;
    font-size: 9px;
    opacity: 0;
    transition: opacity 0.15s ease;
    font-weight: 600;
    margin-left: 6px;
  }

  .update-badge.visible {
    opacity: 1;
  }

  .widget-update-badge {
    cursor: pointer;
  }

  .widget-update-badge:hover {
    background: rgb(74, 58, 25);
  }

  .section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255,255,255,0.5);
    margin: 10px 0 4px;
  }

  .section-label.collapsible {
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
  }

  .section-label-toggle {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .section-order-controls {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .section-label.collapsible:hover .section-order-controls {
    opacity: 1;
  }

  .order-btn {
    cursor: pointer;
    font-size: 8px;
    color: rgba(255,255,255,0.35);
    padding: 2px 3px;
  }

  .order-btn:hover {
    color: rgba(255,255,255,0.85);
  }

  .order-btn.disabled {
    opacity: 0.2;
    cursor: default;
    pointer-events: none;
  }

  .hide-btn {
    cursor: pointer;
    font-size: 8px;
    color: rgba(255,255,255,0.35);
    padding: 2px 3px;
    margin-left: 2px;
  }

  .hide-btn:hover {
    color: #ff5f56;
  }

  .hidden-sections-label {
    font-size: 9px;
    color: rgba(255,255,255,0.4);
  }

  .hidden-section-chip {
    font-size: 9px;
    color: rgba(255,255,255,0.55);
    background: rgb(37, 37, 39);
    border-radius: 10px;
    padding: 2px 8px;
    cursor: pointer;
  }

  .hidden-section-chip:hover {
    color: #E5A00D;
  }

  .caret {
    display: inline-block;
    font-size: 9px;
    transition: transform 0.15s ease, opacity 0.2s ease;
    transform: rotate(0deg);
    opacity: 0;
  }

  .section-label.collapsible:hover .caret {
    opacity: 1;
  }

  .caret.collapsed {
    transform: rotate(-90deg);
  }

  .sub-label {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.75);
    margin: 6px 0 3px;
  }

  .sub-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 6px 0 3px;
  }

  .recent-group-title {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.75);
    cursor: pointer;
  }

  .recent-group-title:hover {
    text-decoration: underline;
  }

  .recent-group-title.scanning {
    color: #E5A00D;
  }

  .recent-order-controls,
  .poster-page-controls {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .recent-group:hover .recent-order-controls,
  .recent-group:hover .poster-page-controls {
    opacity: 1;
  }

  .media-row {
    position: relative;
    overflow: hidden;
    /* Enough gap for two adjacent tiles' glows to breathe without
       touching/merging into each other — poster-glow-pulse can bleed
       roughly 10px on a calm frame up to ~20px at its brightest peak, so
       8px wasn't enough room between an active tile's bottom glow and
       the next tile's top glow. */
    margin-bottom: 24px;
    border-radius: 8px;
    padding: 4px;
    /* A solid base underneath everything — the backdrop art (when there
       is one) is only 55% opacity and blurred, and plenty of sessions
       have no backdrop art at all, so without this the row itself was
       exactly as see-through as the widget's own background slider. */
    background: rgb(30, 30, 32);
  }

  .media-row-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    background: rgba(30, 30, 32, 0.45);
  }

  .media-row.active-glow {
    animation: poster-glow-pulse 3s ease-in-out infinite;
  }

  .poster-large {
    flex-shrink: 0;
    background: rgb(37, 37, 39);
    object-fit: cover;
    width: 40px;
    height: 60px;
    border-radius: 4px;
    display: block;
    cursor: pointer;
    transition: filter 0.4s ease;
  }

  .poster-small {
    flex-shrink: 0;
    background: rgb(37, 37, 39);
    object-fit: cover;
    width: 26px;
    height: 39px;
    border-radius: 3px;
    display: block;
    cursor: pointer;
  }


  .recent-groups {
    display: flex;
    flex-wrap: wrap;
    column-gap: 28px;
    row-gap: 0px;
  }

  /* flex-basis ~208px is exactly enough room for 4 posters per row
     (4 * 40px poster + 3 * 16px gap) — a group never shrinks below
     that, so the default look at the widget's default width is
     unchanged, but flex-grow lets it use extra width once there's
     room, and flex-wrap moves an entire group down to its own line
     (instead of cramming) whenever there isn't enough width left to
     fit it inline next to the others. */
  .recent-group {
    flex: 0 0 208px;
  }
  /* Same overflow:hidden-clips-its-own-box-shadow problem as
     .now-playing-scroll, but the horizontal and vertical axes don't have
     the same amount of safe room: top/bottom has nothing else nearby, so
     14px lets a poster's glow fade out completely (verified with a
     headless render). Left/right is only a 16px gap away from the next
     poster in the carousel (visible or not, depending on paging) -- 14px
     there let that neighbor's own glow bleed into view past the edge of
     the visible 4. 6px keeps the clip boundary safely short of it (also
     verified), at the cost of the visible edge poster's own glow not
     fading quite as fully -- there's no padding value that fixes both
     given how tight that 16px gap is. */
  .recent-row-viewport {
    width: 208px;
    overflow: hidden;
    padding: 14px 6px;
    margin: -14px -6px 0 -6px;
  }

  .recent-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 16px;
    margin-bottom: 8px;
    transition: transform 0.35s ease;
  }

  .recent-item {
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .recent-poster {
    width: 40px;
    height: 60px;
    border-radius: 4px;
    object-fit: cover;
    background: rgb(37, 37, 39);
    cursor: pointer;
    display: block;
    /* Plain solid border on everything by default — .recent-poster-new
       below overrides this with an animated glow, since the animation's
       own box-shadow keyframes take over from this static one while
       it's running. box-shadow instead of a real border so it doesn't
       add to the poster's box size and nudge the layout. */
    box-shadow: 0 0 0 1px rgba(229, 160, 13, 0.9);
  }

  /* Same pulsing Plex-orange glow as an actively playing tile, applied
     to a poster only while it's genuinely fresh — added within the last
     24 hours. isNew above is recomputed on every render, so as soon as
     that window passes the class just stops being added and the glow
     goes away on its own, no timer needed. */
  .recent-poster-new {
    animation: poster-glow-pulse 3s ease-in-out infinite;
  }

  /* Shared pulsing glow — a playing Now Playing tile and a poster added
     within the last 24 hours both use this: a softly blurred border that
     genuinely glows, rather than the old thin 1px ring that barely read
     as anything on a small poster. */
  @keyframes poster-glow-pulse {
    0%, 100% {
      box-shadow: 0 0 2px 1px rgba(229, 160, 13, 0.6), 0 0 5px 1px rgba(229, 160, 13, 0.45);
    }
    50% {
      box-shadow: 0 0 3px 1px rgba(229, 160, 13, 0.9), 0 0 10px 2px rgba(229, 160, 13, 0.8);
    }
  }

  .recent-title {
    font-size: 8px;
    line-height: 1.3;
    text-align: center;
    margin-top: 4px;
    color: rgba(255,255,255,0.75);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .media-body {
    flex: 1;
    min-width: 0;
  }

  .item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    line-height: 1.5;
  }

  .item-title {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Multi-stream alert, at the top-right of the title row -- flex-shrink: 0
     so it never gets squeezed by a long title (the title itself does the
     truncating instead, above). The avatar itself lives at the tile level
     now (see .user-avatar below), centered on the tile's own top-right
     corner rather than sitting inline in this text row. */
  .item-right {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  /* Centered on .media-row's top-right corner -- inset a few px so the
     circle stays fully inside the row's own rounded corner/overflow:hidden
     clip instead of being sliced by it. Free of the title row's flow
     entirely, so its size no longer has any effect on tile height. */
  .user-avatar {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    background: rgb(37, 37, 39);
    border: 2px solid rgba(0, 0, 0, 0.5);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .added-date-label {
    font-size: 10px;
    font-style: italic;
    color: rgba(255,255,255,0.4);
    white-space: nowrap;
  }

  .muted {
    color: rgba(255,255,255,0.45);
    font-size: 11px;
  }

  .stream-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 3px 0;
  }

  /* Added-date sits to the left of the stop button, both pushed to the
     row's right edge as one unit by .stream-meta-row's space-between --
     grouping them here (instead of leaving added-date as a third flex
     item) is what keeps it from overlapping/ colliding with the button. */
  .stream-meta-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    margin-right: 4px;
  }

  .badge-direct { background: rgb(24, 52, 39); color: #35d07f; }
  .badge-stream { background: rgb(31, 45, 62); color: #5aaaff; }
  .badge-transcode { background: rgb(56, 44, 19); color: #E5A00D; }
  .badge-hw { background: rgb(42, 42, 44); color: rgba(255,255,255,0.6); margin-left: 4px; }
  /* Inline resolution/audio format, right after the Direct Play /
     Transcoding badge -- plain muted text normally, tinted the same
     transcode-orange as .badge-transcode when it's a source → actual
     arrow (i.e. this viewer isn't actually getting full quality). */
  .stream-format { margin-right: 4px; }
  .stream-format-downgraded { color: #E5A00D; }
  .state-playing { color: #35d07f; }
  .state-paused { color: #f5c518; }
  .user-name { font-weight: 700; color: #f2f2f2; }

  .multi-stream-alert {
    margin-left: 5px;
    font-size: 11px;
    cursor: default;
  }

  .ip-link {
    cursor: pointer;
  }

  .ip-link:hover {
    text-decoration: underline;
  }

  .ip-alert {
    font-weight: 700;
    color: #ff5f56;
    cursor: pointer;
  }

  .ip-alert:hover {
    text-decoration: underline;
  }

  .stop-btn {
    background: rgb(37, 37, 39);
    color: rgba(255, 255, 255, 0.7);
    border: none;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .media-row:hover .stop-btn {
    opacity: 1;
  }

  .stop-btn:hover {
    background: rgb(70, 35, 35);
    color: #ff5f56;
  }

  .stop-confirm-group {
    display: inline-flex;
    gap: 4px;
  }

  .stop-btn-no:hover {
    background: rgb(56, 56, 58);
    color: #f2f2f2;
  }

  .bar-track {
    display: flex;
    height: 3px;
    background: rgba(255,255,255,0.12);
    border-radius: 2px;
    margin-top: 2px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: #E5A00D;
    flex-shrink: 0;
  }

  /* The solid line is actual playback position; there's no real
     "amount buffered" the Plex API exposes, so this is a lighter,
     gently pulsing segment right after it — a quick visual "yes, this
     stream is actively live" cue rather than a literal buffer meter. */
  @keyframes bar-buffer-pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.6; }
  }

  .bar-buffer {
    height: 100%;
    background: #E5A00D;
    flex-shrink: 0;
    animation: bar-buffer-pulse 1.4s ease-in-out infinite;
  }

  .counts-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 11px;
  }

  .count-pill {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .count-value {
    color: #E5A00D;
  }

  .count-pill-link {
    cursor: pointer;
  }

  .count-pill-link:hover {
    text-decoration: underline;
  }

  .count-pill.scanning {
    background: rgb(56, 44, 19);
  }

  .count-pill.scanning .count-pill-link {
    color: #E5A00D;
  }

  .refresh-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    width: 16px;
    height: 16px;
    padding: 0;
    margin-left: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .recent-group:hover .refresh-btn {
    opacity: 1;
    pointer-events: auto;
  }

  .refresh-btn:hover {
    color: #E5A00D;
  }

  .refresh-icon {
    display: block;
  }

  .refresh-pull-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 0px;
    overflow: hidden;
    opacity: 0;
    color: #E5A00D;
    font-size: 9px;
  }

  .refresh-pull-indicator .refresh-icon {
    flex-shrink: 0;
    transform-origin: 50% 50%;
  }

  .refresh-pull-indicator.refreshing .refresh-icon {
    animation: refresh-spin 0.9s linear infinite;
  }

  .refresh-btn.spinning {
    color: #E5A00D;
  }

  .refresh-btn.spinning .refresh-icon {
    transform-origin: 50% 50%;
    animation: refresh-spin 0.9s linear infinite;
  }

  @keyframes refresh-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .bw-plot {
    position: relative;
    height: 40px;
    margin-top: 4px;
  }

  .bw-gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .bw-gridline-label {
    position: absolute;
    right: 2px;
    top: -7px;
    font-size: 7px;
    color: rgba(255,255,255,0.28);
  }

  .bandwidth-graph {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(60, 1fr);
    align-items: end;
  }

  .bandwidth-bar {
    justify-self: center;
    width: 2px;
    border-radius: 1px;
    min-height: 2px;
  }

  .bandwidth-bar.local { background: #E5A00D; }
  .bandwidth-bar.remote { background: #5aaaff; }

  .bandwidth-bar.overlay {
    opacity: 0.72;
    mix-blend-mode: screen;
  }

  .bw-hit-layer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(60, 1fr);
  }

  .bw-hit-cell {
    position: relative;
    height: 100%;
  }

  .bw-tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 5px;
    background: rgba(20, 20, 22, 0.97);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 4px;
    padding: 3px 7px;
    font-size: 9px;
    white-space: nowrap;
    display: flex;
    flex-direction: column;
    gap: 1px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s ease;
    z-index: 20;
  }

  .bw-hit-cell:hover .bw-tooltip {
    opacity: 1;
  }

  .bw-tooltip-local { color: #E5A00D; }
  .bw-tooltip-remote { color: #5aaaff; }

  .overlay-toggle {
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .counts-row:hover .overlay-toggle {
    opacity: 1;
  }

  .overlay-toggle:hover {
    text-decoration: underline;
  }

  .bw-legend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .bw-legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
  }

  .bw-legend-dot.local { background: #E5A00D; }
  .bw-legend-dot.remote { background: #5aaaff; }

  .bw-axis {
    position: relative;
    height: 10px;
    margin-top: 2px;
  }

  .bw-axis-label {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 8px;
    color: rgba(255,255,255,0.35);
    white-space: nowrap;
  }
`;

// Manual animation for the bandwidth graph: CSS transitions on an SVG
// path's "d" attribute aren't supported by every WebKit build Übersicht
// ships with, so instead we interpolate the point coordinates ourselves
// with requestAnimationFrame and write "d" straight to the DOM node. As
// long as the JSX below keeps handing render() the same settled string
// between ticks, React leaves that attribute alone and this loop is free
// to keep animating it without a fight.
// A row of bars is far more robust than trying to animate an SVG path's
// "d" attribute or hand-roll a requestAnimationFrame loop — both turned
// out to glitch on this WebKit build. A plain CSS "height" transition on
// a div is about as universally supported as animation gets, and since
// each bar sits at a fixed index/position, React just patches that one
// bar's inline style between renders — the transition animates it for
// free, no manual DOM/animation-frame bookkeeping needed at all.
const BANDWIDTH_SCALE_MAX = 100; // Mbps — fixed so the gridlines mean the same thing every tick
const BANDWIDTH_GRID_MARKS = [0, 20, 40, 60, 80, 100];
const BANDWIDTH_GRAPH_HEIGHT = 40; // px — bars and gridlines both compute off this same number

// Pixel heights, not percentages: nesting percentage heights inside a flex
// row inside an absolutely-positioned box has been unreliable on this
// WebKit build, so both the gridlines and the bars are placed using the
// exact same "value / scale * BANDWIDTH_GRAPH_HEIGHT" math in px, which
// guarantees a bar for 10 Mbps lands exactly on the "10" gridline.
function renderBandwidthGraph(history, colorClass) {
  return (
    <div className="bw-plot" style={{ height: `${BANDWIDTH_GRAPH_HEIGHT}px` }}>
      {BANDWIDTH_GRID_MARKS.map((mark) => (
        <div
          key={mark}
          className="bw-gridline"
          style={{ bottom: `${(mark / BANDWIDTH_SCALE_MAX) * BANDWIDTH_GRAPH_HEIGHT}px` }}
        >
          <span className="bw-gridline-label">{mark}</span>
        </div>
      ))}
      <div className="bandwidth-graph">
        {history.map((sample, i) => {
          const px = Math.max(2, Math.min(BANDWIDTH_GRAPH_HEIGHT, (sample.v / BANDWIDTH_SCALE_MAX) * BANDWIDTH_GRAPH_HEIGHT));
          // Keyed by fixed screen position, not by the sample's real
          // second: a stable set of 60 slots means no bar is ever added
          // or removed from the DOM, so nothing ever reflows/snaps when
          // the window advances — only each slot's own height value
          // updates in place.
          return <div key={i} className={`bandwidth-bar ${colorClass}`} style={{ height: `${px}px` }} />;
        })}
      </div>
      {/* A separate hover layer, not the bars themselves — each cell
          spans the full column so you don't need pixel-precise aim on a
          2px-wide bar, and it's pure CSS :hover (no JS state), same as
          every other hover reveal already in this widget. */}
      <div className="bw-hit-layer">
        {history.map((sample, i) => (
          <div key={i} className="bw-hit-cell">
            <span className="bw-tooltip">{sample.v.toFixed(1)} Mbps</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Both series layered in one plot instead of two stacked ones — each
// bar set gets its own full-size absolutely-positioned layer (same
// pattern as the gridlines), with reduced opacity + a "screen" blend
// mode so overlapping local/remote traffic lightens instead of one
// color just covering the other, and either series is still readable
// on its own where they don't overlap.
function renderBandwidthOverlay(localHistory, remoteHistory) {
  return (
    <div className="bw-plot" style={{ height: `${BANDWIDTH_GRAPH_HEIGHT}px` }}>
      {BANDWIDTH_GRID_MARKS.map((mark) => (
        <div
          key={mark}
          className="bw-gridline"
          style={{ bottom: `${(mark / BANDWIDTH_SCALE_MAX) * BANDWIDTH_GRAPH_HEIGHT}px` }}
        >
          <span className="bw-gridline-label">{mark}</span>
        </div>
      ))}
      <div className="bandwidth-graph">
        {localHistory.map((sample, i) => {
          const px = Math.max(2, Math.min(BANDWIDTH_GRAPH_HEIGHT, (sample.v / BANDWIDTH_SCALE_MAX) * BANDWIDTH_GRAPH_HEIGHT));
          return <div key={i} className="bandwidth-bar local overlay" style={{ height: `${px}px` }} />;
        })}
      </div>
      <div className="bandwidth-graph">
        {remoteHistory.map((sample, i) => {
          const px = Math.max(2, Math.min(BANDWIDTH_GRAPH_HEIGHT, (sample.v / BANDWIDTH_SCALE_MAX) * BANDWIDTH_GRAPH_HEIGHT));
          return <div key={i} className="bandwidth-bar remote overlay" style={{ height: `${px}px` }} />;
        })}
      </div>
      <div className="bw-hit-layer">
        {localHistory.map((sample, i) => {
          const remoteSample = remoteHistory[i];
          return (
            <div key={i} className="bw-hit-cell">
              <span className="bw-tooltip">
                <span className="bw-tooltip-local">Local: {sample.v.toFixed(1)} Mbps</span>
                <span className="bw-tooltip-remote">Remote: {remoteSample ? remoteSample.v.toFixed(1) : "0.0"} Mbps</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// history is 60 one-second samples, oldest first — label every 10th slot
// so the axis reads left (oldest) to right ("Now"), matching the bars.
function renderBandwidthAxis() {
  // Position each label at the exact horizontal center of the bar it
  // labels — plain flex "space-between" spread the labels evenly from
  // 0% to 100%, but the bars themselves don't span that: with 60 1s
  // bars, "Now" is the last bar (center ~99%) and "50s ago" is the 10th
  // bar from the end (center ~16%), not the container's edges. That
  // mismatch is what made the Now-to-10s gap look off.
  const totalBars = 60;
  const marksSecondsAgo = [0, 10, 20, 30, 40, 50, 60];
  return (
    <div className="bw-axis">
      {marksSecondsAgo.map((secondsAgo) => {
        // The "60s" mark sits past the oldest bar (bars only cover
        // 59s ago through now) — clamp it to the left edge instead of
        // letting it compute a negative, off-graph index.
        const index = Math.max(0, totalBars - 1 - secondsAgo);
        const leftPct = ((index + 0.5) / totalBars) * 100;
        return (
          <span key={secondsAgo} className="bw-axis-label" style={{ left: `${leftPct}%` }}>
            {secondsAgo === 0 ? "Now" : `${secondsAgo}s`}
          </span>
        );
      })}
    </div>
  );
}

// Section reordering: each section header gets tiny up/down arrows. The
// order is persisted to its own dotfile (same pattern as widget position)
// so it survives Übersicht restarts.
const SECTION_ORDER_FILE = "~/.plex_widget_section_order";
const DEFAULT_SECTION_ORDER = ["nowPlaying", "recentAdded", "activity", "system"];

function moveSection(order, key, delta) {
  const idx = order.indexOf(key);
  const newIdx = idx + delta;
  if (idx === -1 || newIdx < 0 || newIdx >= order.length) return order;
  const newOrder = order.slice();
  const tmp = newOrder[idx];
  newOrder[idx] = newOrder[newIdx];
  newOrder[newIdx] = tmp;
  return newOrder;
}

function persistSectionOrder(order) {
  run(`echo "${order.join(",")}" > ${SECTION_ORDER_FILE}`).catch(() => {});
}

function moveSectionAndDispatch(order, key, delta) {
  const newOrder = moveSection(order, key, delta);
  if (dispatchRef) dispatchRef({ type: "SECTION_ORDER", order: newOrder });
  persistSectionOrder(newOrder);
}

async function loadSavedSectionOrder(dispatch) {
  try {
    const out = await run(`cat ${SECTION_ORDER_FILE} 2>/dev/null`);
    const keys = (out || "").trim().split(",").filter(Boolean);
    const valid = keys.length === DEFAULT_SECTION_ORDER.length && DEFAULT_SECTION_ORDER.every((k) => keys.includes(k));
    if (valid) dispatch({ type: "SECTION_ORDER", order: keys });
  } catch (e) {
    // no saved order yet — defaults from initialState apply
  }
}

// Recently Added's own categories (Movies, Screeners, TV Shows, Games,
// Music) get the same drag-free reorder pattern as the top-level
// sections above, just keyed on the Plex library key instead of a fixed
// set of names — the set of libraries varies per server, so unlike
// section order this doesn't validate against a fixed expected list;
// getRecentCategoryOrder below falls back to the default rank for any
// key it doesn't recognize (a library added after you last reordered).
const RECENT_CATEGORY_ORDER_FILE = "~/.plex_widget_recent_category_order";

function persistRecentCategoryOrder(order) {
  run(`echo "${order.join(",")}" > ${RECENT_CATEGORY_ORDER_FILE}`).catch(() => {});
}

function moveRecentCategoryAndDispatch(currentKeys, key, delta) {
  const newOrder = moveSection(currentKeys, key, delta);
  if (dispatchRef) dispatchRef({ type: "RECENT_CATEGORY_ORDER", order: newOrder });
  persistRecentCategoryOrder(newOrder);
}

// Pages a category's poster row 4 at a time (delta -1/+1), clamped so
// the window never runs past either end of however many items that
// category actually has right now (which can shrink after a refresh).
function movePosterPageAndDispatch(key, offset, itemsLength, delta) {
  const maxOffset = Math.max(0, itemsLength - 4);
  const newOffset = Math.max(0, Math.min(maxOffset, offset + delta * 4));
  if (dispatchRef) dispatchRef({ type: "RECENT_POSTER_PAGE", key, offset: newOffset });
}

async function loadSavedRecentCategoryOrder(dispatch) {
  try {
    const out = await run(`cat ${RECENT_CATEGORY_ORDER_FILE} 2>/dev/null`);
    const keys = (out || "").trim().split(",").filter(Boolean);
    if (keys.length) dispatch({ type: "RECENT_CATEGORY_ORDER", order: keys });
  } catch (e) {
    // no saved order yet — default category rank order applies
  }
}

// Applies the saved custom order to Recently Added's groups, falling
// back to their normal rank (Movies, Screeners, TV Shows, Games, Music,
// then anything else) for any category not in that saved order yet.
function sortedRecentBySection(recentBySection, recentCategoryOrder) {
  if (!recentCategoryOrder.length) return recentBySection;
  return recentBySection.slice().sort((a, b) => {
    const ai = recentCategoryOrder.indexOf(a.key);
    const bi = recentCategoryOrder.indexOf(b.key);
    const aIdx = ai >= 0 ? ai : recentCategoryOrder.length + a.rank;
    const bIdx = bi >= 0 ? bi : recentCategoryOrder.length + b.rank;
    return aIdx - bIdx;
  });
}

// Hiding a section is different from collapsing it — collapse keeps the
// header (and its name) visible with just the contents tucked away;
// hide drops the whole section, header included, out of the widget
// entirely. Same dotfile-persistence pattern as section order/position.
const HIDDEN_SECTIONS_FILE = "~/.plex_widget_hidden_sections";
const SECTION_LABELS = {
  nowPlaying: "Now Playing",
  recentAdded: "Recently Added",
  activity: "Activity",
  system: "Bandwidth & CPU",
};

function persistHiddenSections(keys) {
  run(`echo "${keys.join(",")}" > ${HIDDEN_SECTIONS_FILE}`).catch(() => {});
}

function hideSectionAndDispatch(hiddenSections, key) {
  if (hiddenSections.includes(key)) return;
  const next = [...hiddenSections, key];
  if (dispatchRef) dispatchRef({ type: "HIDDEN_SECTIONS", hiddenSections: next });
  persistHiddenSections(next);
}

function showSectionAndDispatch(hiddenSections, key) {
  const next = hiddenSections.filter((k) => k !== key);
  if (dispatchRef) dispatchRef({ type: "HIDDEN_SECTIONS", hiddenSections: next });
  persistHiddenSections(next);
}

async function loadSavedHiddenSections(dispatch) {
  try {
    const out = await run(`cat ${HIDDEN_SECTIONS_FILE} 2>/dev/null`);
    const keys = (out || "").trim().split(",").filter(Boolean);
    if (keys.length) dispatch({ type: "HIDDEN_SECTIONS", hiddenSections: keys });
  } catch (e) {
    // none hidden yet
  }
}

// Same hide pattern as the top-level sections above, but for Recently
// Added's individual library categories (Movies, TV Shows, Music,
// Screeners, etc). Keyed on the Plex library key rather than a fixed
// label map, since the set of libraries varies per server -- the footer
// restore chip looks the title up from recentBySection at render time
// instead.
const HIDDEN_RECENT_CATEGORIES_FILE = "~/.plex_widget_hidden_recent_categories";

function persistHiddenRecentCategories(keys) {
  run(`echo "${keys.join(",")}" > ${HIDDEN_RECENT_CATEGORIES_FILE}`).catch(() => {});
}

function hideRecentCategoryAndDispatch(hiddenRecentCategories, key) {
  if (hiddenRecentCategories.includes(key)) return;
  const next = [...hiddenRecentCategories, key];
  if (dispatchRef) dispatchRef({ type: "HIDDEN_RECENT_CATEGORIES", hiddenRecentCategories: next });
  persistHiddenRecentCategories(next);
}

function showRecentCategoryAndDispatch(hiddenRecentCategories, key) {
  const next = hiddenRecentCategories.filter((k) => k !== key);
  if (dispatchRef) dispatchRef({ type: "HIDDEN_RECENT_CATEGORIES", hiddenRecentCategories: next });
  persistHiddenRecentCategories(next);
}

async function loadSavedHiddenRecentCategories(dispatch) {
  try {
    const out = await run(`cat ${HIDDEN_RECENT_CATEGORIES_FILE} 2>/dev/null`);
    const keys = (out || "").trim().split(",").filter(Boolean);
    if (keys.length) dispatch({ type: "HIDDEN_RECENT_CATEGORIES", hiddenRecentCategories: keys });
  } catch (e) {
    // none hidden yet
  }
}

// Same dotfile-persistence pattern as everything else — one small file
// per collapsible section, read back on launch so a collapsed/expanded
// choice survives an Übersicht restart instead of resetting every time.
const COLLAPSE_FILE_PREFIX = "~/.plex_widget_collapsed_";

const BANDWIDTH_OVERLAY_FILE = "~/.plex_widget_bandwidth_overlay";

async function loadSavedBandwidthOverlay(dispatch) {
  try {
    const out = await run(`cat ${BANDWIDTH_OVERLAY_FILE} 2>/dev/null`);
    if ((out || "").trim() === "true") dispatch({ type: "TOGGLE_BANDWIDTH_OVERLAY" });
  } catch (e) {
    // no saved state yet — defaults from initialState apply
  }
}

function persistCollapsedToggle(key, willBeCollapsed) {
  run(`echo "${willBeCollapsed}" > ${COLLAPSE_FILE_PREFIX}${key}`).catch(() => {});
}

async function loadSavedCollapsedSections(dispatch) {
  const sections = [
    { key: "nowPlaying", toggleType: "TOGGLE_NOW_PLAYING" },
    { key: "recentAdded", toggleType: "TOGGLE_RECENT" },
    { key: "activity", toggleType: "TOGGLE_ACTIVITY" },
    { key: "system", toggleType: "TOGGLE_SYSTEM" },
  ];
  for (const { key, toggleType } of sections) {
    try {
      const out = await run(`cat ${COLLAPSE_FILE_PREFIX}${key} 2>/dev/null`);
      if ((out || "").trim() === "true") dispatch({ type: toggleType });
    } catch (e) {
      // no saved state yet — defaults from initialState apply
    }
  }
}

function renderSectionHeader(order, key, label, collapsed, toggleType, hiddenSections) {
  const idx = order.indexOf(key);
  return (
    <div className="section-label collapsible">
      <span
        className="section-label-toggle"
        onClick={() => {
          persistCollapsedToggle(key, !collapsed);
          dispatchRef && dispatchRef({ type: toggleType });
        }}
      >
        <span className={`caret ${collapsed ? "collapsed" : ""}`}>▾</span> {label}
      </span>
      <span className="section-order-controls">
        <span
          className={`order-btn ${idx <= 0 ? "disabled" : ""}`}
          onClick={() => idx > 0 && moveSectionAndDispatch(order, key, -1)}
          title="Move section up"
        >
          ▲
        </span>
        <span
          className={`order-btn ${idx === order.length - 1 ? "disabled" : ""}`}
          onClick={() => idx < order.length - 1 && moveSectionAndDispatch(order, key, 1)}
          title="Move section down"
        >
          ▼
        </span>
        <span
          className="hide-btn"
          onClick={() => hideSectionAndDispatch(hiddenSections, key)}
          title="Hide this section"
        >
          ✕
        </span>
      </span>
    </div>
  );
}

function displayTitleForSession(m) {
  if (m.grandparentTitle) return `${m.grandparentTitle} — ${m.title}`;
  return m.title || "Unknown";
}

// Plex sends episode air dates as "YYYY-MM-DD" — reformat to
// "Month Day(th/st/nd/rd), Year", e.g. "December 12th, 2009".
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinalSuffix(day) {
  if (day % 10 === 1 && day !== 11) return "st";
  if (day % 10 === 2 && day !== 12) return "nd";
  if (day % 10 === 3 && day !== 13) return "rd";
  return "th";
}

function formatAiredDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
  const dayNum = parseInt(day, 10);
  if (!monthName || !dayNum) return dateStr;
  return `${monthName} ${dayNum}${ordinalSuffix(dayNum)}, ${year}`;
}

// Same "Month Day(th), Year" format as formatAiredDate, but for
// addedAt -- Plex reports that one as Unix seconds, not a "YYYY-MM-DD"
// string, so it needs its own Date-based formatter.
function formatAddedDate(unixSeconds) {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  const monthName = MONTH_NAMES[d.getMonth()];
  const dayNum = d.getDate();
  return `${monthName} ${dayNum}${ordinalSuffix(dayNum)}, ${d.getFullYear()}`;
}

function displayTitleForRecent(m) {
  if (m.__seasonGroupCount) {
    const seasonLabel = m.parentIndex != null ? `Season ${m.parentIndex}` : m.parentTitle || "Season";
    return `${m.grandparentTitle || ""} — ${seasonLabel}`;
  }
  if (m.type === "episode") return `${m.grandparentTitle || ""} — ${m.title || ""}`;
  if (m.type === "season") return `${m.parentTitle || ""} ${m.title || ""}`;
  // Music recentlyAdded — a Plex album's parent is its artist; a bare
  // track's grandparent is the artist (parent is the album instead).
  if (m.type === "album") return `${m.parentTitle || ""} — ${m.title || ""}`;
  if (m.type === "track") return `${m.grandparentTitle || ""} — ${m.title || ""}`;
  return m.title || "Unknown";
}

function posterUrl(m) {
  // A grouped season tile favors the season's own poster over the
  // show's — it's showing a specific season, not the show in general.
  const path = m.__seasonGroupCount
    ? m.parentThumb || m.grandparentThumb || m.thumb
    : m.grandparentThumb || m.thumb || m.parentThumb;
  if (!path) return null;
  return `${PLEX_URL}${path}?X-Plex-Token=${PLEX_TOKEN}`;
}

// Deep-link to view this item on your server's own Plex Web interface.
function itemWebUrl(machineIdentifier, m) {
  const key = m.key || (m.ratingKey ? `/library/metadata/${m.ratingKey}` : null);
  if (!key || !machineIdentifier) return null;
  return `${PLEX_URL}/web/index.html#!/server/${machineIdentifier}/details?key=${encodeURIComponent(key)}`;
}

// Deep-link straight to a library section's browse view.
function libraryWebUrl(machineIdentifier, sectionKey) {
  if (!machineIdentifier || !sectionKey) return null;
  return `${PLEX_URL}/web/index.html#!/media/${machineIdentifier}/com.plexapp.plugins.library?source=${sectionKey}`;
}

// Background art for one specific stream, used behind its own row.
function sessionArtUrl(s) {
  const path = s && (s.grandparentArt || s.parentArt || s.art);
  if (!path) return null;
  return `${PLEX_URL}${path}?X-Plex-Token=${PLEX_TOKEN}`;
}

// The signed-in user's avatar for this stream. Plex-account avatars come
// back as an already-absolute plex.tv URL (no token needed); a managed
// Home user without one can come back with a relative path off your own
// server instead, same as posters/art, so only prefix it when it isn't
// already a full URL.
function userAvatarUrl(s) {
  const thumb = s && s.User && s.User.thumb;
  if (!thumb) return null;
  if (/^https?:\/\//i.test(thumb)) return thumb;
  return `${PLEX_URL}${thumb}?X-Plex-Token=${PLEX_TOKEN}`;
}

function formatTime(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatEndClock(remainingMs) {
  if (remainingMs == null || isNaN(remainingMs)) return null;
  const end = new Date(Date.now() + remainingMs);
  return end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Reads the play method (direct play / direct stream / transcode) and
// current bandwidth off a /status/sessions entry.
function getStreamInfo(s) {
  const media = s.Media && s.Media[0];
  const part = media && media.Part && media.Part[0];
  const decision = (part && part.decision) || (s.TranscodeSession && s.TranscodeSession.videoDecision) || null;

  let decisionLabel = "Unknown";
  let badgeClass = "badge-direct";
  if (decision === "transcode") {
    decisionLabel = "Transcoding";
    badgeClass = "badge-transcode";
  } else if (decision === "copy") {
    decisionLabel = "Direct Stream";
    badgeClass = "badge-stream";
  } else if (decision === "directplay") {
    decisionLabel = "Direct Play";
    badgeClass = "badge-direct";
  }

  const bandwidthKbps = s.Session && s.Session.bandwidth;
  const speedLabel = bandwidthKbps ? `${(bandwidthKbps / 1000).toFixed(1)} Mbps` : null;

  const transcodeSpeed = s.TranscodeSession && typeof s.TranscodeSession.speed === "number"
    ? s.TranscodeSession.speed
    : null;

  let hwLabel = null;
  if (decision === "transcode" && s.TranscodeSession) {
    const usesHw =
      s.TranscodeSession.transcodeHwRequested ||
      s.TranscodeSession.transcodeHwEncoding ||
      s.TranscodeSession.transcodeHwDecoding;
    hwLabel = usesHw ? "HW" : "SW";
  }

  return { decisionLabel, badgeClass, speedLabel, transcodeSpeed, hwLabel };
}

// Plex's videoResolution is a mixed bag -- "4k", "1080", "1080i", "sd",
// sometimes a raw height -- normalize whatever comes in to a display
// label rather than assuming one shape.
function formatResolutionLabel(res) {
  if (res == null || res === "") return null;
  const v = String(res).toLowerCase();
  if (v === "4k") return "4K";
  if (v === "sd") return "SD";
  const n = parseInt(v, 10);
  return isNaN(n) ? v.toUpperCase() : `${n}p`;
}

// TranscodeSession only reports a raw pixel height for the output, not
// Plex's friendlier resolution string -- bucket it the same way Plex's
// own quality picker does.
function heightToResolutionLabel(height) {
  const h = Number(height);
  if (!h) return null;
  if (h >= 2160) return "4K";
  if (h >= 1440) return "1440p";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 576) return "576p";
  if (h >= 480) return "480p";
  return `${h}p`;
}

function formatChannelsLabel(channels) {
  const n = Number(channels);
  if (!n) return null;
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  if (n === 6) return "5.1";
  if (n === 8) return "7.1";
  return `${n}ch`;
}

// Source label vs. what the viewer is actually getting -- only pairs
// them into a "source → actual" arrow when they genuinely differ, so a
// straight direct play just shows the one value with no arrow noise.
function buildFormatLabel(sourceLabel, actualLabel) {
  if (!sourceLabel && !actualLabel) return null;
  if (sourceLabel && actualLabel && sourceLabel !== actualLabel) {
    return { label: `${sourceLabel} → ${actualLabel}`, downgraded: true };
  }
  return { label: actualLabel || sourceLabel, downgraded: false };
}

// A live session dump (2026-08-29, an actively-transcoding 1080p source
// downscaled to 720p) confirmed Plex rewrites Media/Part/Stream's own
// height/videoResolution/audioCodec fields to describe the transcode
// OUTPUT the moment a session starts transcoding -- Media, Part, AND the
// video Stream itself all reported height:720 for a source file that's
// actually 1080p, and Media.audioCodec reported "ac3" for a source
// that's actually EAC3+Atmos. Those numeric fields are still exactly
// right for "what's actually being delivered" (which is why they're
// still used below for the *actual* side of each pair) -- they just
// can't tell you what the source originally was once a transcode is
// running. The one place the source resolution survives is the video
// Stream's own displayTitle/extendedDisplayTitle text (e.g.
// "1080p (H.264)"), which Plex derives from the source file and doesn't
// rewrite; this pulls the leading resolution token back out of that.
function parseSourceResFromDisplayTitle(title) {
  if (!title) return null;
  const m = String(title).match(/^(4k|8k|sd|\d{3,4})p?\b/i);
  if (!m) return null;
  const token = m[1].toLowerCase();
  if (token === "4k") return "4K";
  if (token === "8k") return "8K";
  if (token === "sd") return "SD";
  return `${token}p`;
}

// Resolution and audio format actually being delivered for this stream,
// each as its own source-vs-actual pair -- video and audio can transcode
// independently (e.g. only the audio gets downmixed for a device that
// can't do 5.1 passthrough while the video stays direct stream).
function getPlaybackFormatInfo(s) {
  const media = s.Media && s.Media[0];
  const part = media && media.Part && media.Part[0];
  const videoStream = part && part.Stream && part.Stream.find((st) => Number(st.streamType) === 1);
  const ts = s.TranscodeSession;

  const actualResLabel = media
    ? formatResolutionLabel(media.videoResolution) || heightToResolutionLabel(media.height)
    : null;
  const sourceResLabel =
    (videoStream && parseSourceResFromDisplayTitle(videoStream.displayTitle || videoStream.extendedDisplayTitle)) ||
    actualResLabel;
  const resolution = buildFormatLabel(sourceResLabel, actualResLabel);

  const sourceChannelsLabel = media ? formatChannelsLabel(media.audioChannels) : null;
  // Same rewrite problem hits Media.audioCodec during a transcode (also
  // confirmed in the same dump) -- TranscodeSession.sourceAudioCodec is
  // Plex's own explicit "what the source actually is" field, so it's
  // used ahead of Media.audioCodec whenever a TranscodeSession exists.
  const sourceCodecLabel =
    (ts && ts.sourceAudioCodec ? ts.sourceAudioCodec.toUpperCase() : null) ||
    (media && media.audioCodec ? media.audioCodec.toUpperCase() : null);
  const sourceAudioLabel = [sourceChannelsLabel, sourceCodecLabel].filter(Boolean).join(" ") || null;

  const audioTranscoding = ts && ts.audioDecision === "transcode";
  const actualChannelsLabel = audioTranscoding
    ? formatChannelsLabel(ts.audioChannels) || sourceChannelsLabel
    : sourceChannelsLabel;
  const actualCodecLabel = audioTranscoding
    ? (ts.audioCodec ? ts.audioCodec.toUpperCase() : sourceCodecLabel)
    : sourceCodecLabel;
  const actualAudioLabel = [actualChannelsLabel, actualCodecLabel].filter(Boolean).join(" ") || null;
  const audio = buildFormatLabel(sourceAudioLabel, actualAudioLabel);

  return { resolution, audio };
}

function hideOnError(e) {
  e.target.style.display = "none";
}

// Finds whichever tile is ACTUALLY sitting at the top of the visible
// scrollport right now (closest to BUFFER px below the container's own
// top edge) — not always rows[0]. Shared by the cap-height math below
// and the scroll-snap logic in onNowPlayingScroll, so both always agree
// on which pair is "current".
function findNowPlayingTopIndex(rows, containerTop, buffer) {
  let topIndex = 0;
  let closestDelta = Infinity;
  rows.forEach((row, i) => {
    const delta = Math.abs(row.getBoundingClientRect().top - containerTop - buffer);
    if (delta < closestDelta) {
      closestDelta = delta;
      topIndex = i;
    }
  });
  // A fast scroll can land the browser's native max scrollTop close
  // enough to the very LAST row that it comes out "closest" here — but
  // the last row has no next row to pair with, which collapsed the cap
  // to showing just that one tile instead of the final pair. Always
  // leave room for a partner below by capping at rows.length - 2 (safe
  // since this only ever runs with 3+ rows).
  return Math.min(topIndex, rows.length - 2);
}

// This went through several broken iterations before landing here —
// worth spelling out why, so it doesn't get "simplified" back into one
// of them. Tiles aren't uniform height (a movie tile has a "Directed
// by" line an episode tile doesn't, a paused tile has an extra timer
// line, etc.):
//  - Sizing the cap off a fixed pair (always rows[0]/[1]) clips
//    whichever tile lands on top once a taller pair scrolls into view.
//  - Sizing off the tallest tile doubled avoids clipping, but leaves
//    slack that lets a 3rd tile peek in whenever the *current* pair is
//    shorter than that worst case.
//  - Adding a flat "top buffer" on top of the container's own
//    padding-top double-counts that padding for the rows[0] case,
//    which is exactly what caused the peeking above.
// The fix: reserve a SINGLE uniform buffer (matching the container's
// own 16px padding) on both edges of whichever pair is measured, verify
// via a real browser (not hand arithmetic) that clientHeight comes out
// exactly right, and drive the scroll position itself (see
// onNowPlayingScroll) so it always settles with exactly that buffer
// showing above the top tile — instead of hoping the cap height alone
// produces it. Confirmed empirically for the rest pair, a middle pair,
// and the final pair, in both border-box and content-box.
let lastMeasuredCapHeight = null;
function measureNowPlayingCapHeight() {
  try {
    const container = document.querySelector(".now-playing-scroll");
    if (!container) return lastMeasuredCapHeight;
    // While a pull-to-refresh is being dragged, or committed and waiting
    // on the fetch, .now-playing-tiles carries a translateY() transform
    // for the drag animation. That shifts every row's
    // getBoundingClientRect() without changing real layout, which threw
    // off the top-tile math below right as a pull committed — freeze the
    // last known-good height instead of recomputing off a transformed
    // layout, and let it settle again once the pull resets to 0.
    if (pullState.distance > 0 || pullState.refreshing) return lastMeasuredCapHeight;
    const rows = container.querySelectorAll(":scope > .now-playing-tiles > .media-row");
    // Below 3 tiles, leave the container uncapped — nothing should be
    // able to scroll/shift upward with only 1 or 2 streams showing.
    if (rows.length < 3) {
      lastMeasuredCapHeight = null;
      return null;
    }

    const GAP = 24; // matches .media-row's margin-bottom
    const BUFFER = 8; // glow/border breathing room — kept small so a hidden neighbor row's own glow doesn't bleed into view (see GAP above)

    const containerTop = container.getBoundingClientRect().top;
    const topIndex = findNowPlayingTopIndex(rows, containerTop, BUFFER);

    const topRow = rows[topIndex];
    const nextRow = rows[topIndex + 1] || null;
    const topHeight = topRow.getBoundingClientRect().height;
    const nextHeight = nextRow ? nextRow.getBoundingClientRect().height : 0;
    const contentHeight = nextRow ? topHeight + GAP + nextHeight : topHeight;
    const clientHeightNeeded = BUFFER + contentHeight + BUFFER;

    const cs = getComputedStyle(container);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const isBorderBox = cs.boxSizing === "border-box";

    // border-box: max-height sets the OUTER box directly, which is
    // clientHeight + border (padding is already inside clientHeight).
    // content-box: max-height sets only the content box, and the
    // browser adds padding back on top to reach clientHeight — so the
    // padding needs subtracting here to land on the same clientHeight.
    let maxHeight;
    if (isBorderBox) {
      maxHeight = clientHeightNeeded + borderTop + borderBottom;
    } else {
      maxHeight = clientHeightNeeded - paddingTop - paddingBottom;
    }
    lastMeasuredCapHeight = Math.max(0, Math.ceil(maxHeight));
    return lastMeasuredCapHeight;
  } catch (e) {
    return lastMeasuredCapHeight;
  }
}

// Pull-to-refresh: trackpad wheel events while already scrolled to the
// top of Now Playing accumulate a "pull" distance (no native overscroll
// event exists for a plain div, so this is hand-rolled). 150ms after the
// last wheel event — a rough stand-in for "the gesture ended" — either
// commits to an immediate refresh (past the 60px threshold) or snaps
// the indicator back to nothing.
const pullState = { distance: 0, refreshing: false, cooldownUntil: 0 };
let pullEndTimer = null;
let wheelGestureTimer = null; // null between gestures — a gap of 200ms with no wheel event means the next one starts a new gesture
let atTopAtGestureStart = false;
let capUpdateTimer = null;
let lastNowPlayingAtBottom = false;
let lastNowPlayingAtTop = true;

function onNowPlayingScroll(e) {
  const container = e.currentTarget;
  // Drive the hint's arrow off dispatched state rather than mutating its
  // textContent directly — a direct DOM write here got stomped back to
  // whatever the JSX says every ~2s on the next Now Playing poll
  // re-render, which is why the arrow used to revert to pointing down
  // even while sitting at the bottom of the scroll.
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 4;
  const atTop = container.scrollTop <= 4;
  if (atBottom !== lastNowPlayingAtBottom || atTop !== lastNowPlayingAtTop) {
    lastNowPlayingAtBottom = atBottom;
    lastNowPlayingAtTop = atTop;
    if (dispatchRef) dispatchRef({ type: "NOW_PLAYING_SCROLL_STATE", atBottom, atTop });
  }

  // Debounced until scrolling actually settles, so this doesn't fight
  // the scroll gesture itself by moving/resizing things mid-motion.
  clearTimeout(capUpdateTimer);
  capUpdateTimer = setTimeout(() => {
    const rows = container.querySelectorAll(":scope > .now-playing-tiles > .media-row");
    if (rows.length >= 3) {
      // CSS scroll-snap alone wasn't reliably landing on a tile
      // boundary in Übersicht's renderer, which is what let a tile's
      // own top glow/border clip against the viewport edge. Snap the
      // scroll position explicitly instead: find whichever tile is
      // closest to the top and smooth-scroll so it sits with exactly
      // BUFFER (16px) of clearance above it, matching the same buffer
      // the cap-height math (measureNowPlayingCapHeight) reserves.
      const BUFFER = 8; // must match measureNowPlayingCapHeight's BUFFER
      const containerTop = container.getBoundingClientRect().top;
      const topIndex = findNowPlayingTopIndex(rows, containerTop, BUFFER);
      const topRow = rows[topIndex];
      const topRowOffset = topRow.getBoundingClientRect().top - containerTop + container.scrollTop;
      const target = Math.max(0, topRowOffset - BUFFER);
      if (Math.abs(container.scrollTop - target) > 1) {
        container.scrollTo({ top: target, behavior: "smooth" });
      }
    }
    const capHeight = measureNowPlayingCapHeight();
    container.style.maxHeight = capHeight ? `${capHeight}px` : "";
  }, 120);
}

function onNowPlayingWheel(e) {
  const container = e.currentTarget;
  const indicator = container.querySelector(".refresh-pull-indicator");
  const icon = indicator && indicator.querySelector(".refresh-icon");
  if (!indicator || !icon || pullState.refreshing || Date.now() < pullState.cooldownUntil) return;

  if (!wheelGestureTimer) {
    // First wheel event in a while — a new gesture is starting, so this
    // is the one chance to check whether it's already resting at the
    // top. A swipe that arrives at the top mid-gesture (scrolled up from
    // lower in the list) keeps atTopAtGestureStart false for the rest of
    // this gesture, even once scrollTop reaches 0.
    atTopAtGestureStart = container.scrollTop <= 0;
  }
  clearTimeout(wheelGestureTimer);
  wheelGestureTimer = setTimeout(() => {
    wheelGestureTimer = null;
  }, 200);

  if (!(atTopAtGestureStart && container.scrollTop <= 0 && e.deltaY < 0)) return;

  // More "weight" = more resistance: each wheel tick now moves the
  // indicator less (0.5 -> 0.3 per unit of scroll), and the pull has to
  // travel further before it triggers (60 -> 85), so it takes a
  // noticeably more deliberate pull to fire a refresh instead of
  // triggering off a quick/light scroll.
  pullState.distance = Math.min(140, pullState.distance + -e.deltaY * 0.18);
  const pct = Math.min(1, pullState.distance / 130);
  indicator.style.height = `${Math.round(pullState.distance)}px`;
  indicator.style.opacity = String(pct);
  icon.style.transform = `rotate(${pct * 360}deg)`;
  const tiles = container.querySelector(".now-playing-tiles");
  if (tiles) tiles.style.transform = `translateY(${Math.round(pullState.distance)}px)`;

  clearTimeout(pullEndTimer);
  pullEndTimer = setTimeout(() => {
    if (pullState.distance >= 130) {
      pullState.refreshing = true;
      pullState.cooldownUntil = Date.now() + 1200;
      indicator.classList.add("refreshing");
      const label = indicator.querySelector(".refresh-pull-label");
      if (label) label.textContent = "Refreshing…";

      // Force the list back to the very top the moment a pull commits,
      // regardless of where it was scrolled beforehand — a pull can
      // still fire partway through one continuous swipe up from lower
      // in the list (it only needs to cross scrollTop 0 at some point
      // during the gesture), and leaving whatever scrollTop that left
      // behind made the refreshed list look like it "jumped" somewhere
      // else once the underlying rows shifted.
      container.scrollTop = 0;
      lastNowPlayingAtTop = true;
      lastNowPlayingAtBottom = false;
      if (dispatchRef) dispatchRef({ type: "NOW_PLAYING_SCROLL_STATE", atTop: true, atBottom: false });

      let safetyTimer;
      const finishRefresh = () => {
        // Guards against running twice — once from whichever of the
        // fetch settling or the safety timeout below fires first.
        if (!pullState.refreshing) return;
        clearTimeout(safetyTimer);
        pullState.refreshing = false;
        pullState.distance = 0;
        indicator.style.height = "0px";
        indicator.style.opacity = "0";
        indicator.classList.remove("refreshing");
        if (label) label.textContent = "Pull to refresh";
        const tilesEl = container.querySelector(".now-playing-tiles");
        if (tilesEl) tilesEl.style.transform = "translateY(0px)";
      };

      // A stalled request — dropped wifi, the Mac waking from sleep
      // mid-fetch, a server that never answers — can leave
      // pollNowPlaying's promise never settling. Since the guard at the
      // top of this function blocks every new pull while
      // pullState.refreshing is true, that used to wedge the gesture
      // permanently: the indicator would sit stuck on "Refreshing…"
      // forever and no further pull would ever do anything. This forces
      // a cleanup after 8s no matter what the fetch does.
      safetyTimer = setTimeout(finishRefresh, 8000);

      pollNowPlaying(dispatchRef).finally(finishRefresh);
    } else {
      pullState.distance = 0;
      indicator.style.height = "0px";
      indicator.style.opacity = "0";
      const tilesEl = container.querySelector(".now-playing-tiles");
      if (tilesEl) tilesEl.style.transform = "translateY(0px)";
    }
  }, 150);
}

export const render = ({
  isOnline,
  avatarUrl,
  serverName,
  machineIdentifier,
  sessions,
  recentBySection,
  counts,
  confirmingSessionId,
  actionMessage,
  recentAddedCollapsed,
  nowPlayingCollapsed,
  nowPlayingAtBottom,
  nowPlayingAtTop,
  systemCollapsed,
  bandwidthOverlay,
  recentCategoryOrder,
  recentPosterOffset,
  activityCollapsed,
  cpuProcessPct,
  memProcessPct,
  localBandwidthHistory,
  remoteBandwidthHistory,
  serverVersion,
  availableVersion,
  latestWidgetVersion,
  lastUpdatedAt,
  streamStartedAt,
  pausedAt,
  totalPlaysToday,
  topTitle,
  topTitleCount,
  topUser,
  topUserCount,
  sectionOrder,
  hiddenSections,
  hiddenRecentCategories,
}) => {
  const userCount = new Set(sessions.map((s) => (s.User && s.User.title) || "Unknown")).size;
  const pausedCount = sessions.filter((s) => s.Player && s.Player.state === "paused").length;
  // Caps Now Playing at 2 full tiles with the rest reachable by
  // scrolling — null on the very first render (nothing on the DOM to
  // measure yet) or once fewer than 2 tiles exist, in which case it's
  // left uncapped since there's nothing to scroll to anyway.
  const nowPlayingCapHeight = measureNowPlayingCapHeight();
  // Which section is currently last among the visible ones — sections
  // can be hidden or reordered, so this isn't always "system". Only that
  // one skips its bottom divider, so the divider never ends up sitting
  // directly above the footer controls no matter what's hidden/reordered.
  const lastVisibleSectionKey = ["nowPlaying", "recentAdded", "activity", "system"]
    .filter((k) => !hiddenSections.includes(k))
    .sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b))
    .pop() || null;
  // How many concurrent sessions each account currently has — used to
  // flag possible account sharing/abuse when one login is streaming
  // from 2+ places at once (same IP or different IPs, doesn't matter).
  const sessionCountByUser = {};
  sessions.forEach((s) => {
    const u = (s.User && s.User.title) || "Unknown";
    sessionCountByUser[u] = (sessionCountByUser[u] || 0) + 1;
  });
  // Only streams actually playing right now — a paused stream isn't
  // transferring data, so it shouldn't count toward "current" bandwidth.
  const totalBandwidthKbps = sessions
    .filter((s) => !(s.Player && s.Player.state === "paused"))
    .reduce((sum, s) => sum + ((s.Session && s.Session.bandwidth) || 0), 0);
  const updateAvailable = availableVersion && serverVersion && availableVersion !== serverVersion;
  const widgetUpdateAvailable = isNewerVersion(latestWidgetVersion, WIDGET_VERSION);
  const updatedSecondsAgo = lastUpdatedAt != null ? Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000)) : null;
  const totalSpeedLabel = totalBandwidthKbps > 0 ? `${(totalBandwidthKbps / 1000).toFixed(1)} Mbps` : null;

  return (
    <div className="widget-root">
      <div className="row">
        <span className="title">
          {avatarUrl && (
            <img className={`avatar${isOnline ? " avatar-online" : ""}`} src={avatarUrl} onError={hideOnError} onClick={() => openExternal(plexServerWebUrl())} />
          )}
          <span className={`dot ${isOnline ? "online" : "offline"}`} />
          {isOnline ? <span className="server-title">{SERVER_DISPLAY_NAME}</span> : "Plex Offline"}
        </span>
        <span className="row-right">
          <img className="header-logo-icon" src="data:image/png;base64,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IljrTiQS5HK5Abkg3aWmpoZ8Po/jOGSzWS699FI9d+5cPWLEiIFuWp/gei7V1dXcdNNNL1RVVfX594UCr2HMYKWjlML3fPbaay9qa2t7ff+pVIof//jHe1ZKGbDS8aGuro7LLruMs846S1uWRWNjI8lkMipcX0lorcnn8/i+j+u6DB8+nHvvuVdfeOGFQHAvVTqO4+D5Hh999BG33nprENauVK+M3Yb2GSJhr8/Yi74wYwr5pgXYIouJRrhUvPvLR+ALE4cUzc4Q/vvKCv728FohU+AbYCRNhOyZcZTNZtlll1045+xzoslOuSCl5LzzzmP69OlHhr/3exv6/RvLAGnIyBAbNWoUl112GXPnztXV1dVAIOaaTqcrYobb2NiIlJK99tpr5Ouvv64vveRSIEi9LYc0294mkUjw4Ycf8pe//GWvxsbGPv++5ubmluzSQRAOFvbpZDLJaaed1icH9NRTT7340ksv4XvlP4Epxfd8HMfhiiuu4Mwzz9TJZJJcLodlWRXrBdVaM378eJ544gn99SO+TiKRwHGcil9ihcDDl0gkOProo0UYYtI948sobO28ImDCKIac8I1p41Oygepk4DPCL2QOakn37ZO+zXpsm2W54ZaYqQQNGYvla4Zy9z0fT17dDE0upGtSKO21GvO6ut9iEokEd999tzZMoyxloJRS3HTTTffV1dUNiJRR+Z2RfkQaQWxUOp1mwoQJrFixQt933316iy22IJPJlGWHKWXChAncfffd+rnnnlux88474/le9OALg20HE1prrrzySsf3/X7xSORyuShw2VeVZ1CU4rounh/UQzz33HN7ff/ZbDZMdNm13DMg2yNss+u6XHXVVdx99926traWTCZTcR4wCGb12223Ha+88orebrvtosoFWmtc1x0U48N9993HW2+91TPPVyGWSeMj8TGFjyXhuG+MWbPFuDzCX4WTb27RkNNh8H25PyNCaYjWG4AWJlmVJjV0Kr//4wvMXchCLcFOJ1m9JothiGBBUXfd6CrtTxdddJHeZptt2n2tHJAyKEt2991364GYYG0yWZBdRSlFU1MT9913H1dffbVYsmQJYbp+OAD7vo9t2ziO0+tGWigjUZwuDoHnIpVKkclkEEIwefJkTjjhBH3JJZe0+nzp5awEL15nFMsZfPzxx2y55ZZCa43neT0+vs66/7x58/S4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" alt="" />
          <span className="drag-handle" onMouseDown={startDrag} title="Drag to move">⠿</span>
        </span>
        <span className="header-streaming-info muted">{userCount} streaming{pausedCount > 0 ? ` · ${pausedCount} paused` : ""}{totalSpeedLabel ? ` · ${totalSpeedLabel}` : ""}</span>
      </div>

      <div className="server-version-row">
        <span className={`update-badge${updateAvailable ? " visible" : ""}`}>Update available</span>
        <span
          className={`update-badge widget-update-badge${widgetUpdateAvailable ? " visible" : ""}`}
          onClick={() => widgetUpdateAvailable && openExternal(`https://github.com/${STREAMPULSE_REPO}/releases/latest`)}
          title={latestWidgetVersion ? `StreamPulse ${latestWidgetVersion} available (you have ${WIDGET_VERSION})` : ""}
        >
          StreamPulse update available
        </span>
      </div>

      <div className="section-now-playing" style={{ order: sectionOrder.indexOf("nowPlaying"), display: hiddenSections.includes("nowPlaying") ? "none" : undefined }}>
      {renderSectionHeader(sectionOrder, "nowPlaying", "Now Playing", nowPlayingCollapsed, "TOGGLE_NOW_PLAYING", hiddenSections)}
      {!nowPlayingCollapsed && (
      <div
        className="now-playing-scroll"
        style={{ maxHeight: nowPlayingCapHeight ? `${nowPlayingCapHeight}px` : undefined }}
        onWheel={onNowPlayingWheel}
        onScroll={onNowPlayingScroll}
      >
      <div className="refresh-pull-indicator">
        <svg className="refresh-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        </svg>
        <span className="refresh-pull-label">Pull to refresh</span>
      </div>
      <div className="now-playing-tiles">
      {sessions.length === 0 ? (
        <div className="media-row media-row-empty">
          <span className="muted">Nothing is playing right now...</span>
        </div>
      ) : (
      sessions.map((s, i) => {
        const pct = s.duration ? Math.min(100, Math.max(0, (s.viewOffset / s.duration) * 100)) : 0;
        const remainingMs = s.duration != null && s.viewOffset != null ? Math.max(0, s.duration - s.viewOffset) : null;
        const poster = posterUrl(s);
        const webUrl = itemWebUrl(machineIdentifier, s);
        const info = getStreamInfo(s);
        const playback = getPlaybackFormatInfo(s);
        const sessionId = s.Session && s.Session.id;
        const isConfirming = confirmingSessionId === sessionId;
        const isPaused = s.Player && s.Player.state === "paused";
        const pausedSinceMs = isPaused && sessionId && pausedAt[sessionId] ? Date.now() - pausedAt[sessionId] : null;
        const rowClass = `media-row ${isPaused ? "row-paused" : "active-glow"}`;
        const rowArtUrl = sessionArtUrl(s);
        const avatarUrl = userAvatarUrl(s);
        const username = (s.User && s.User.title) || "Unknown";
        const ip = (s.Player && (s.Player.remotePublicAddress || s.Player.address)) || null;
        const isMultiStream = (sessionCountByUser[username] || 0) >= 2;
        const addedLabel = formatAddedDate(s.addedAt);
        return (
          <div key={i} className={rowClass}>
            {rowArtUrl && <div className="row-backdrop-art" style={{ backgroundImage: `url(${rowArtUrl})` }} />}
            {avatarUrl && (
              <img className="user-avatar" src={avatarUrl} onError={hideOnError} title={username} />
            )}
            <div className="media-row-content">
            {poster && (
              <img className="poster-large" src={poster} onError={hideOnError} onClick={() => openExternal(webUrl)} />
            )}
            <div className="media-body">
              <div className="item">
                <span className="item-title">{displayTitleForSession(s)}</span>
                <span className="item-right">
                  {isMultiStream && (
                    <span className="multi-stream-alert" title={`${username} has ${sessionCountByUser[username]} streams playing at once`}>⚠️</span>
                  )}
                </span>
              </div>
              {s.type === "episode" && s.parentIndex != null && s.index != null && (
                <div className="muted">
                  Season {s.parentIndex}, Episode {s.index}
                  {s.originallyAvailableAt && ` (Aired on ${formatAiredDate(s.originallyAvailableAt)})`}
                </div>
              )}
              {s.type === "movie" && (
                <div className="muted">
                  Directed by: {s.Director && s.Director.length > 0 ? s.Director.map((d) => d.tag).join(", ") : "Unknown"}
                  {s.originallyAvailableAt && ` (Premiered on ${formatAiredDate(s.originallyAvailableAt)})`}
                </div>
              )}
              <div className="muted status-line">
                <strong className="user-name">{username}</strong> · <span className={`state-${((s.Player && s.Player.state) || "").toLowerCase()}`}>{(s.Player && s.Player.state) || "?"}</span>
                {pausedSinceMs != null && (
                  <span className={`pause-timer${pausedSinceMs > 3600000 ? " pause-timer-flash" : ""}`}>
                    {` (${formatTime(pausedSinceMs)})`}
                  </span>
                )}
              </div>
              <div className="muted">
                {(s.Player && s.Player.title) || "Unknown device"} ·{" "}
                {ip ? (
                  isMultiStream ? (
                    <span className="ip-alert" onClick={() => openExternal(`https://ipinfo.io/${ip}`)} title="Multiple concurrent streams — click to look up this IP">
                      {ip}
                    </span>
                  ) : (
                    <span className="ip-link" onClick={() => openExternal(`https://ipinfo.io/${ip}`)} title="Click to look up this IP">
                      {ip}
                    </span>
                  )
                ) : (
                  "IP unknown"
                )}
              </div>
              <div className="muted">{formatTime(remainingMs)} left · {formatTime(s.duration)} total · ends {formatEndClock(remainingMs) || "--:--"}</div>
              <div className="stream-meta-row">
                <span>
                  <span className={`badge ${info.badgeClass}`}>
                    {info.decisionLabel}
                  </span>
                  {playback.resolution && (
                    <span className={`muted stream-format${playback.resolution.downgraded ? " stream-format-downgraded" : ""}`}>
                      · {playback.resolution.label}
                    </span>
                  )}
                  {playback.audio && (
                    <span className={`muted stream-format${playback.audio.downgraded ? " stream-format-downgraded" : ""}`}>
                      · {playback.audio.label}
                    </span>
                  )}
                  {info.hwLabel && <span className="badge badge-hw">{info.hwLabel}</span>}
                  <span className="muted">{info.speedLabel || "—"}</span>
                </span>
                <span className="stream-meta-right">
                  {addedLabel && (
                    <span className="added-date-label" title={`Added to library on ${addedLabel}`}>
                      Added on {addedLabel}
                    </span>
                  )}
                  {isConfirming ? (
                    <span className="stop-confirm-group">
                      <button
                        className="stop-btn stop-btn-yes"
                        onClick={() => stopSession(sessionId, displayTitleForSession(s))}
                      >
                        Yes
                      </button>
                      <button
                        className="stop-btn stop-btn-no"
                        onClick={() => dispatchRef && dispatchRef({ type: "CONFIRM_STOP", sessionId: null })}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      className="stop-btn"
                      onClick={() => dispatchRef && dispatchRef({ type: "CONFIRM_STOP", sessionId })}
                    >
                      Stop
                    </button>
                  )}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%` }} />
                {!isPaused && <div className="bar-buffer" style={{ width: `${Math.min(100 - pct, 12)}%` }} />}
              </div>
            </div>
            </div>
          </div>
        );
      })
      )}
      </div>
      </div>
      )}
      {!nowPlayingCollapsed && sessions.length >= 3 && (
        <div className="scroll-more-hint">
          <span className="scroll-more-arrow">{nowPlayingAtTop && !nowPlayingAtBottom ? "▾" : !nowPlayingAtTop && nowPlayingAtBottom ? "▴" : nowPlayingAtTop && nowPlayingAtBottom ? "▾" : "▴▾"}</span>
          <span className="scroll-more-label">Scroll for more</span>
        </div>
      )}
      {lastVisibleSectionKey !== "nowPlaying" && <div className="section-divider" />}
      </div>

      <div style={{ order: sectionOrder.indexOf("recentAdded"), display: hiddenSections.includes("recentAdded") ? "none" : undefined }}>
      {renderSectionHeader(sectionOrder, "recentAdded", "Recently Added", recentAddedCollapsed, "TOGGLE_RECENT", hiddenSections)}
      {!recentAddedCollapsed && (
        <div>
          {recentBySection.length === 0 && <div className="muted">Nothing yet</div>}
          <div className="recent-groups">
            {(() => {
              // orderKeys stays the full sorted list (hidden categories
              // included) so the persisted reorder file always reflects
              // every category's position, not just the visible ones --
              // only the actual rendered grid below is filtered down to
              // the categories that aren't hidden.
              const ordered = sortedRecentBySection(recentBySection, recentCategoryOrder);
              const orderKeys = ordered.map((s) => s.key);
              return ordered.filter((s) => !hiddenRecentCategories.includes(s.key)).map((section) => {
              // Merged in from the old standalone Library section — same
              // item count / refresh button, just living on the Recently
              // Added group header instead of its own separate section.
              const c = counts.find((x) => x.key === section.key);
              const oi = orderKeys.indexOf(section.key);
              const posterOffset = Math.min(
                recentPosterOffset[section.key] || 0,
                Math.max(0, section.items.length - 4)
              );
              const visibleItems = section.items.slice(posterOffset, posterOffset + 4);
              return (
              <div key={section.key} className="recent-group">
                <div className="sub-label-row">
                  <span
                    className={`recent-group-title${c && c.refreshing ? " scanning" : ""}`}
                    onClick={() => c && openExternal(libraryWebUrl(machineIdentifier, c.key))}
                    title={c ? (c.refreshing ? "Scanning…" : "Open this library in Plex Web") : undefined}
                  >
                    {section.title}
                    {c != null && ` · ${c.count.toLocaleString()}`}
                  </span>
                  <span className="recent-order-controls">
                    <span
                      className={`order-btn ${oi <= 0 ? "disabled" : ""}`}
                      onClick={() => oi > 0 && moveRecentCategoryAndDispatch(orderKeys, section.key, -1)}
                      title="Move this category up"
                    >
                      ▲
                    </span>
                    <span
                      className={`order-btn ${oi === orderKeys.length - 1 ? "disabled" : ""}`}
                      onClick={() => oi < orderKeys.length - 1 && moveRecentCategoryAndDispatch(orderKeys, section.key, 1)}
                      title="Move this category down"
                    >
                      ▼
                    </span>
                    <span
                      className="hide-btn"
                      onClick={() => hideRecentCategoryAndDispatch(hiddenRecentCategories, section.key)}
                      title="Hide this category"
                    >
                      ✕
                    </span>
                  </span>
                  {section.items.length > 4 && (
                    <span className="poster-page-controls">
                      <span
                        className={`order-btn ${posterOffset <= 0 ? "disabled" : ""}`}
                        onClick={() => posterOffset > 0 && movePosterPageAndDispatch(section.key, posterOffset, section.items.length, -1)}
                        title="Show the previous 4"
                      >
                        ‹
                      </span>
                      <span
                        className={`order-btn ${posterOffset + 4 >= section.items.length ? "disabled" : ""}`}
                        onClick={() => posterOffset + 4 < section.items.length && movePosterPageAndDispatch(section.key, posterOffset, section.items.length, 1)}
                        title="Show the next 4"
                      >
                        ›
                      </span>
                    </span>
                  )}
                  {c && (
                    <button
                      className={`refresh-btn${c.refreshing ? " spinning" : ""}`}
                      onClick={() => refreshSection(c)}
                      title="Scan this library on the server"
                    >
                      <svg className="refresh-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                      </svg>
                    </button>
                  )}
                </div>
                {section.items.length === 0 && <div className="muted">Nothing yet</div>}
                <div className="recent-row-viewport">
                <div className="recent-row" style={{ transform: `translateX(-${posterOffset * 56}px)` }}>
                  {section.items.map((r) => {
                    const poster = posterUrl(r);
                    const webUrl = itemWebUrl(machineIdentifier, r);
                    // Plex's addedAt is Unix seconds — a season-group tile
                    // keeps the most recently added episode's addedAt, so
                    // this is correct for grouped tiles too.
                    const isNew = r.addedAt && Date.now() - r.addedAt * 1000 < 24 * 60 * 60 * 1000;
                    const itemKey = r.ratingKey || (r.key ? r.key : `${section.key}-${r.addedAt}-${displayTitleForRecent(r)}`);
                    return (
                      <div key={itemKey} className="recent-item">
                        {poster && (
                          <img
                            className={`recent-poster${isNew ? " recent-poster-new" : ""}`}
                            src={poster}
                            onError={hideOnError}
                            onClick={() => openExternal(webUrl)}
                          />
                        )}
                        <div className="recent-title">{displayTitleForRecent(r)}</div>
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
              );
              });
            })()}
          </div>
        </div>
      )}
      {lastVisibleSectionKey !== "recentAdded" && <div className="section-divider" />}
      </div>

      <div style={{ order: sectionOrder.indexOf("activity"), display: hiddenSections.includes("activity") ? "none" : undefined }}>
      {renderSectionHeader(sectionOrder, "activity", "Activity", activityCollapsed, "TOGGLE_ACTIVITY", hiddenSections)}
      {!activityCollapsed && (
        <div className="counts-row">
          <span className="count-pill">Plays Today: <span className="count-value">{totalPlaysToday}</span></span>
          <span className="count-pill">
            Top Title: <span className="count-value">{topTitle ? `${topTitle} (${topTitleCount}×)` : "—"}</span>
          </span>
          <span className="count-pill">
            Top User: <span className="count-value">{topUser ? topUser : "—"}</span>
          </span>
        </div>
      )}
      {lastVisibleSectionKey !== "activity" && <div className="section-divider" />}
      </div>

      <div style={{ order: sectionOrder.indexOf("system"), display: hiddenSections.includes("system") ? "none" : undefined }}>
      {renderSectionHeader(sectionOrder, "system", "Bandwidth & CPU", systemCollapsed, "TOGGLE_SYSTEM", hiddenSections)}
      {!systemCollapsed && (
        <div>
          <div className="counts-row">
            <span className="count-pill">Plex CPU: {cpuProcessPct != null ? `${cpuProcessPct.toFixed(0)}%` : "—"}</span>
            <span className="count-pill">Plex RAM: {memProcessPct != null ? `${memProcessPct.toFixed(0)}%` : "—"}</span>
            <span
              className="overlay-toggle"
              onClick={() => {
                run(`echo "${!bandwidthOverlay}" > ${BANDWIDTH_OVERLAY_FILE}`).catch(() => {});
                dispatchRef && dispatchRef({ type: "TOGGLE_BANDWIDTH_OVERLAY" });
              }}
              title={bandwidthOverlay ? "Show local/remote as two separate graphs" : "Overlay local/remote into one graph"}
            >
              {bandwidthOverlay ? "Split" : "Overlay"}
            </span>
          </div>

          {bandwidthOverlay ? (
            <div>
              <div className="sub-label bw-legend">
                <span className="bw-legend-dot local" />
                Local: {localBandwidthHistory.length ? `${localBandwidthHistory[localBandwidthHistory.length - 1].v.toFixed(1)} Mbps` : "—"}
                <span className="bw-legend-dot remote" style={{ marginLeft: "8px" }} />
                Remote: {remoteBandwidthHistory.length ? `${remoteBandwidthHistory[remoteBandwidthHistory.length - 1].v.toFixed(1)} Mbps` : "—"}
              </div>
              {renderBandwidthOverlay(localBandwidthHistory, remoteBandwidthHistory)}
              {renderBandwidthAxis()}
            </div>
          ) : (
            <div>
              <div className="sub-label">
                Local Bandwidth: {localBandwidthHistory.length ? `${localBandwidthHistory[localBandwidthHistory.length - 1].v.toFixed(1)} Mbps` : "—"}
              </div>
              {renderBandwidthGraph(localBandwidthHistory, "local")}
              {renderBandwidthAxis()}

              <div className="sub-label">
                Remote Bandwidth: {remoteBandwidthHistory.length ? `${remoteBandwidthHistory[remoteBandwidthHistory.length - 1].v.toFixed(1)} Mbps` : "—"}
              </div>
              {renderBandwidthGraph(remoteBandwidthHistory, "remote")}
              {renderBandwidthAxis()}
            </div>
          )}
        </div>
      )}
      {lastVisibleSectionKey !== "system" && <div className="section-divider" />}
      </div>

      <div className="widget-controls" style={{ order: 999 }}>
      <div className="bottom-controls-row">
        <div className="hidden-sections-group">
          {(hiddenSections.length > 0 || hiddenRecentCategories.length > 0) && (
            <span className="hidden-sections-label">Hidden:</span>
          )}
          {hiddenSections.map((key) => (
            <span
              key={key}
              className="hidden-section-chip"
              onClick={() => showSectionAndDispatch(hiddenSections, key)}
              title="Click to show this section again"
            >
              {SECTION_LABELS[key] || key} +
            </span>
          ))}
          {hiddenRecentCategories.map((key) => {
            const sec = recentBySection.find((s) => s.key === key);
            return (
              <span
                key={key}
                className="hidden-section-chip"
                onClick={() => showRecentCategoryAndDispatch(hiddenRecentCategories, key)}
                title="Click to show this category again"
              >
                {(sec && sec.title) || key} +
              </span>
            );
          })}
        </div>
        <div className="bg-opacity-group">
          <span className="bg-opacity-label">Transparency:</span>
          <span className="bg-opacity-value">{Math.round((1 - currentBgOpacity()) * 100)}%</span>
          <input
            type="range"
            className="bg-opacity-slider"
            min="0"
            max="100"
            step="1"
            defaultValue={String(Math.round((1 - currentBgOpacity()) * 100))}
            onChange={onBgOpacitySliderChange}
            title="Background transparency"
          />
        </div>
      </div>
      <div className="bg-color-row">
        <span className={`bottom-error-message${actionMessage ? " visible" : ""}`}>{actionMessage || ""}</span>
        <div className="bg-color-group">
          <span className="bg-color-label">Background:</span>
          <div className="bg-color-swatches">
            {BG_COLOR_PRESETS.map((c) => (
              <span
                key={c.rgb}
                className={`bg-color-swatch${currentBgColor() === c.rgb ? " bg-color-swatch-selected" : ""}`}
                style={{ backgroundColor: `rgb(${c.rgb})` }}
                title={c.label}
                onClick={(e) => onBgColorSwatchClick(e, c.rgb)}
              />
            ))}
          </div>
        </div>
      </div>
      </div>
      <span className="resize-handle" onMouseDown={startResize} title="Drag to resize">◢</span>
    </div>
  );
};
