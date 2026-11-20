import { dropSources } from "@/enums";
import { Track } from "@/interfaces";

/**
 * The rendered height of a track row, in px — the single source for every
 * fixed-size scroller that stacks `SongItem`s. Mirrors `$song-item-height`
 * (4.5rem, _variables.scss); the pair is tied together by
 * components/__tests__/songRowHeight.test.ts.
 *
 * ⚠️ A `RecycleScroller` does NOT measure: it pitches its rows at exactly
 * `item-size`, and a row taller than that OVERLAPS the one above it — the
 * scroller's item wrapper is `overflow: visible` (app-grid.scss), so nothing
 * clips and nothing errors. Three lists carried a hand-written `64` against a
 * 72px row, so every row covered the bottom 8px of its predecessor, and with
 * it the perforation that separates two rows: measured on the running app the
 * ink dashes came out rgb(226,224,220) instead of rgb(23,23,26) — all that
 * showed through the next row's 92%-opaque veil plate was 8% of them. The same
 * rows under a `DynamicScroller` (album view), which measures, painted full ink.
 *
 * `DynamicScroller`'s `min-item-size` is deliberately NOT this constant: it is
 * a pre-measurement estimate, and those scrollers host mixed content (disc
 * bars, card rows, headers) whose height is not a track row's.
 */
export const SONG_ROW_HEIGHT = 72;

/**
 * How many accents the colour guide band cycles through. Must match
 * `$mem-band-colours` in _candy.scss, which emits one `band-N` class per entry;
 * a class this returns without a matching rule leaves that row with no band.
 */
// ONE. It was five, then two (coral/teal), and each time the hue said less than
// it cost: five accents only ever meant "third row in the cycle", and two made
// the band carry two messages at once (which neighbour, how far down). The
// perforation already separates neighbours, so the band now says one thing in
// one colour — how far into the list a row sits: see `trackBandFade`. The
// class machinery stays so a second accent is a one-line change again.
export const TRACK_BAND_COUNT = 1;

/**
 * How many strengths the band snaps to. Hard steps, not a smooth ramp: Memphis
 * draws with flat fills and hard edges (no blur, cuts instead of fades), and a
 * ramp of a dozen near-identical tints read as a gradient. Four steps read like
 * the LED segments of a tape-deck level meter — several rows share a segment.
 */
export const TRACK_BAND_LEVELS = 4;

/** Weakest the band ever gets, so row 1 still has a visible spine. */
export const TRACK_BAND_MIN_FADE = 0.25;

/**
 * The `band-N` class for a track row's colour guide band (the inlay spine on
 * the leading edge).
 *
 * Derived from the row's ordinal rather than `:nth-child`, because track lists
 * render through vue-virtual-scroller: it RECYCLES row elements, so DOM
 * position there follows the scroll offset instead of the list, and an
 * nth-child rule would give the same track a different colour on every scroll.
 *
 * `index` is whatever the call site passes as the ordinal, and that is not
 * always a plain integer — the album view passes the track number off the tags,
 * and the prop's type allows a string. It can also DESCEND: `TopTracks.vue`
 * numbers backwards from a `total` (`total - index`), which Favorites.vue feeds
 * from its API count. That goes negative once `index` passes `total` — i.e.
 * when MORE rows are rendered than the count claims, a stale or capped count
 * against a longer loaded list. Anything unparseable falls back to the first
 * accent, so a row is never the only one without a spine.
 */
export function trackBandClass(index: number | string): string {
  const n = Number.parseInt(String(index), 10);
  if (!Number.isFinite(n)) return "band-0";
  // JS `%` keeps the sign of the dividend, and `band--2` matches no rule.
  return `band-${((n % TRACK_BAND_COUNT) + TRACK_BAND_COUNT) % TRACK_BAND_COUNT}`;
}

/**
 * How strong a row's band is: 0.25 at the top of the list, 1 at the bottom, in
 * `TRACK_BAND_LEVELS` hard steps (0.25 · 0.5 · 0.75 · 1).
 *
 * This is the part that carries information: the STRENGTH says how far into
 * the list a row sits — readable mid-scroll, when the scrollbar is the only
 * other clue. Each step covers an equal share of the list; the last row is
 * always full strength, the first always the floor.
 *
 * Normalised against the list LENGTH, not an absolute step count. An absolute
 * scale keeps one step meaning the same everywhere, but on a 993-track playlist
 * everything past its cap looks identical; normalising uses the whole range in
 * every list, which is what a scrollbar does too.
 *
 * `position` is the 1-based RENDERED position (top row = 1), not the `index`
 * prop. The two disagree exactly where it matters: the album view numbers its
 * rows per disc, and the favourites lists number DOWNWARDS from the total —
 * a fade fed those ordinals would restart mid-list or run upside down.
 *
 * Without a usable total (mixed sources, unknown length) the fade is 1 — a
 * uniform, full-strength band is the honest fallback, never an invisible one.
 */
export function trackBandFade(position: number, total?: number): number {
  if (!Number.isFinite(position) || !total || total < 2) return 1;
  const pos = Math.min(Math.max(position - 1, 0), total - 1);
  const level = Math.min(TRACK_BAND_LEVELS - 1, Math.floor((pos / (total - 1)) * TRACK_BAND_LEVELS));
  return TRACK_BAND_MIN_FADE + ((1 - TRACK_BAND_MIN_FADE) * level) / (TRACK_BAND_LEVELS - 1);
}

export function showDragStart(
  e: DragEvent,
  track: Track,
  oldIndex: number,
  source: dropSources = dropSources.folder
) {
  console.log("drag start");
  console.log(source);
  const dragDiv = document.getElementById("drag-img") as HTMLDivElement;
  dragDiv.innerText = track.title;
  e.dataTransfer?.setDragImage(dragDiv, -15, 0);

  // add track object to dataTransfer
  e.dataTransfer?.clearData();
  e.dataTransfer?.setData(
    "aivinnet-track",
    JSON.stringify({ track, source, oldIndex })
  );
}

export function handleDrop(e: DragEvent, index: number, top: boolean) {
  const data = e.dataTransfer?.getData("aivinnet-track");
  if (!data) return;

  const drop_data = JSON.parse(data) as {
    track: Track;
    oldIndex: number;
    source: dropSources;
  };
  console.log(drop_data);

  // find dropped index
  const newIndex = top ? index - 1 : index + 1;
  console.log(newIndex + 1);
  return { ...drop_data, newIndex };
}

/**
 * Whether `row` is the file that `playing` is — given both already share a
 * trackhash.
 *
 * ⚠️ A trackhash is `title + album + artists`, not the file. Files that agree
 * on all three share one hash even when they are different songs: a game
 * soundtrack whose region themes are all titled "2" or "3" lit up every row of
 * that title as "now playing". So two known filepaths have to be equal.
 *
 * Not the duration: #858 let files within 2 s of each other count as the same
 * recording (FLAC + MP3), and two of those "3" themes are 0:28 and 0:26 long —
 * both stayed lit. Short tracks of one series are often that close.
 *
 * What this gives up: a collapsed list (album view, playlist) shows one file
 * per hash, the best-bitrate one, and the queue is built from that same file
 * when playback starts there. Only a lower-bitrate duplicate started from the
 * folder view goes unmarked on the album page — no marker beats a wrong one.
 *
 * Without a filepath on either side (an old saved queue) the hash alone
 * decides, which is what callers checked before.
 */
export function isSameRecording(
  playing: Pick<Track, "filepath"> | undefined | null,
  row: Pick<Track, "filepath">
): boolean {
  if (!playing?.filepath || !row.filepath) return true;
  return playing.filepath === row.filepath;
}
