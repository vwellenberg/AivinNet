# AivinNet Client — Features

This documents what the **AivinNet** fork adds or changes on top of the upstream
[swingmx/webclient](https://github.com/swingmx/webclient). Everything below was
verified against the current code and classified against the fork's merge-base
with upstream.

**Legend**

- 🆕 **New** — does not exist upstream, added by the fork
- ⬆️ **Enhanced** — upstream had a basic version, the fork extended it
- 🔀 **Behavior change** — same capability, different default or flow
- 🎨 **Redesign** — visual/branding only, no new capability
- ➖ **Removed** — existed upstream, removed in the fork

---

## Playlists

- 🆕 **Drag-and-drop track reordering** — grab any row and drag it up/down. A blue
  insertion line shows where it will land, the list updates instantly, and the new
  order is persisted to the server (`PUT /playlist/{id}/reorder`). Disabled while
  the list is filtered by a search query.
- 🆕 **Pin playlists** — pin/unpin from the sidebar context menu or the playlist
  page; pinned playlists sort to the top of the sidebar and show a small green,
  Spotify-style tilted push-pin badge. Pin state stays in sync across the sidebar
  and the open page.
- 🆕 **Working right-click context menu** on sidebar playlists (Play / Pin / Delete).
  Upstream had this menu in code but it only logged to the console and was never
  shown.
- 🆕 **Playlist library list in the sidebar** — covers with a hover play overlay,
  active-row highlight, and reactive updates (pin/delete without a reload).
- 🆕 **Click-to-play from the sidebar** — hover a playlist cover in the sidebar and
  click the green play button to start it; toggles pause/play when it is the
  current source.
- 🆕 **Cover fallback** — playlists without their own image show the first track's
  album art instead of a generic note icon (using the real `has_image` flag).
- 🆕 **Download a playlist as a ZIP** — button next to Play on the playlist header.
- ⬆️ **Delete UX** — confirmation modal, instant removal from the sidebar, and it
  only navigates away if you were viewing the deleted playlist.

> Creating, renaming, and adding tracks to playlists are inherited from upstream
> swingmusic.

## Album covers (MusicBrainz)

- 🆕 **Per-album cover fetch** — a button on the album header pulls a missing cover
  from MusicBrainz / Cover Art Archive; the icon spins while fetching and the cover
  refreshes on success.
- 🆕 **Batch fetch in Settings** — an "Album Cover" section fetches *all* missing
  covers in one background batch, with a live remaining-count, progress percentage
  (polled every 2 s), an "all covers present ✓" state, and a retry action for albums
  with no match. Re-attaches to an already-running batch.

## Downloads

- 🆕 **Download a single track** from a track's context menu.
- 🆕 **Download an album as a ZIP** from the album context menu.
- 🆕 **Download a playlist as a ZIP** from the playlist header.

## Appearance & layout

- ⬆️ **Color-matched ambient gradient** — album, artist, and playlist pages bleed the
  cover's dominant color from the top into a dark Spotify-style gradient (fades to
  near-black), replacing the flat grey.
- ⬆️ **Readable header text** — text over the colored header is luminance-based
  white/near-black instead of a tinted hue-shifted color.
- ⬆️ **Spotify-style track rows** — artists moved under the title; hovering a row
  shows a play triangle over the cover thumbnail.
- ⬆️ **Spotify-style cards** — hover reveals a small green corner play button.
- 🎨 **Spotify-style bottom bar** — centered shuffle/prev/play/next/repeat, a white
  play circle, and an always-visible horizontal volume slider (green on hover).
- 🔀 **Favorite heart** moved next to the now-playing title (bottom-bar left).
- 🎨 **Full-width black top bar** with the AivinNet logo pinned far-left, plus a round
  Home button (🆕) next to the search field.
- 🎨 **Animated brand glow** around the AivinNet planet logo (replaces the old
  "Swing Music" wordmark); branded mobile slide-out drawer.
- 🆕 **Mobile contextual title** — the mobile top bar shows the current page name.
- 🆕 **Resizable left sidebar** — drag the right edge (clamped 180–420 px); width is
  remembered across reloads.
- 🆕 **Font selection** — switch the UI typeface between Default and a Spotify-style
  font (Figtree); persisted and applied app-wide.
- 🆕 **Version label** under Settings → About — client version (from `package.json`)
  alongside the server's.
- 🎨 **AivinNet rebrand** — tab title, favicon, PWA manifest name/description, and
  in-app strings.

## Navigation & defaults

- 🔀 **Settings** is reached only via the profile avatar dropdown (the sidebar gear
  was removed).
- 🔀 **Statistics** is now reachable via a chart icon in the sidebar. *(The Stats
  page already existed upstream but had no navigation entry — it could only be
  opened by typing the `/stats` URL.)*
- 🔀 **Recently Played** is pinned to the top of the Home feed.
- 🆕 **Folder view starts inside the library root** and clamps the breadcrumb to it,
  so you can no longer click above the root into a path the backend rejects.
- 🔀 **Folder view defaults** — sort by name, and compact list mode, by default.
- 🔀 **Browse Library** on Home no longer duplicates destinations already in the
  sidebar.

## Removed

- ➖ **Plugins settings section** — lyrics auto-download and Last.fm configuration are
  no longer reachable in Settings (the lyrics display page itself still works).
- ➖ **Last.fm** removed from the "Search on" context menu.
- ➖ **Back/forward arrows** removed from the top bar.
- ➖ **Time-of-day greeting** removed from the Home header.

## Under the hood

- 🔀 **Self-destroying service worker** — no precaching PWA; the service worker only
  unregisters itself and clears old caches, so deployed updates are always visible
  on a normal reload.
- 🔀 **SVG `viewBox` preserved** — control icons scale to their CSS size instead of
  being clipped.
- 🆕 **CI** — GitHub Actions running lint / tests (Vitest) / build.
