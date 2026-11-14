<template>
  <div class="lyricsview content-page">
    <div
      v-if="queue.currenttrack"
      id="lyricscontent"
      class="content-page rounded"
      @wheel.passive="onScroll"
    >
      <LyricsHead />
      <div v-if="lyrics.synced && hasLyrics" class="lyrics-plate synced">
        <div id="lyricsline--1"></div>
        <button
          v-for="(line, index) in lyrics.lyrics"
          :id="`lyricsline-${index}`"
          :key="line.time"
          type="button"
          class="line"
          :class="{
            current: index == lyrics.currentLine,
            seen: index < lyrics.currentLine,
          }"
          :style="index == lyrics.currentLine ? currentLineStyle : undefined"
          @click="queue.seek(line.time / 1000)"
        >
          <span class="stamp">{{ formatSeconds(line.time / 1000) }}</span>
          <span
            v-if="index == lyrics.currentLine && currentWords.length"
            class="text words"
            ><template v-for="(word, w) in currentWords" :key="w"
              >{{ word.lead
              }}<span
                class="word"
                :class="{ sung: w < currentWord, singing: w == currentWord }"
                >{{ word.core }}</span
              >{{ word.trail }}</template
            ></span
          >
          <span v-else class="text">{{ line.text }}</span>
        </button>
      </div>
      <div v-if="!lyrics.synced && hasLyrics" class="lyrics-plate unsynced">
        <div id="lyricsline--1"></div>
        <p v-for="(line, index) in lyrics.lyrics" :key="index" class="line-plain">
          {{ line }}
        </p>
      </div>
      <div v-if="lyrics.copyright && hasLyrics" class="copyright">
        {{ lyrics.copyright }}
      </div>
      <div v-if="!hasLyrics" class="nolyrics">
        <div class="big">You don't have the lyrics for this song</div>
        <div class="sub">{{ queue.currenttrack.title }}</div>
        <PluginFind v-if="settings.use_lyrics_plugin" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";

import useLyrics from "@/stores/lyrics";
import useQueue from "@/stores/queue";
import useSettings from "@/stores/settings";

import LyricsHead from "./Head.vue";
import PluginFind from "./Plugins/Find.vue";
import usePlaybackClock from "@/composables/usePlaybackClock";
import { currentWordIndex, lineWords, splitSpacing } from "@/utils/lyricsWords";
import formatSeconds from "@/utils/useFormatSeconds";
import updatePageTitle from "@/utils/updatePageTitle";

const queue = useQueue();
const lyrics = useLyrics();
const settings = useSettings();

const hasLyrics = computed(() => !!lyrics.lyrics && lyrics.lyrics.length > 0);

// Playback position in ms, carried forward between the audio's ~250 ms reports
// so the word highlight and the scrubber move with the music, not in steps.
// Only while there is a synced line to time: no frame loop otherwise.
const clock = usePlaybackClock(
  () => queue.duration.current,
  () => queue.playing && lyrics.synced && hasLyrics.value
);

/**
 * Start and end of the current line, in ms. The line's own timestamp is its
 * start; the next line's is its end. The last line has no successor, so it ends
 * with the track — 0 while the duration is not known yet.
 */
const currentSpan = computed(() => {
  const index = lyrics.currentLine;
  const lines = lyrics.lyrics;

  if (!lyrics.synced || index < 0 || index >= lines.length) return null;

  const end =
    index + 1 < lines.length
      ? lines[index + 1].time
      : queue.duration.full * 1000;

  return { line: lines[index], start: lines[index].time, end };
});

/** How far playback has run INTO the current line, 0 → 1. */
const lineProgress = computed(() => {
  const span = currentSpan.value;
  if (!span || !(span.end > span.start)) return 0;

  return Math.min(
    Math.max((clock.value - span.start) / (span.end - span.start), 0),
    1
  );
});

const currentLineWords = computed(() => {
  const span = currentSpan.value;
  return span ? lineWords(span.line, span.end).words : [];
});

const currentWords = computed(() =>
  currentLineWords.value.map((word) => splitSpacing(word.text))
);
const currentWord = computed(() =>
  currentWordIndex(currentLineWords.value, clock.value)
);

const currentLineStyle = computed(() => ({
  "--line-progress": `${lineProgress.value * 100}%`,
}));

const onScroll = (e: Event) => {
  lyrics.setUserScrolled(true);
};

function fetchLyrics() {
  lyrics.getLyrics();
}

onMounted(() => {
  updatePageTitle("Lyrics");
  if (!queue.currenttrack) return;
  fetchLyrics();
  lyrics.scrollToCurrentLine();
});
</script>

<style lang="scss">
.lyricsview {
  height: 100%;
  padding-bottom: 1rem;
}

#lyricscontent {
  padding: 0 2rem 4rem;
  height: 100%;
  overflow: hidden scroll;
  scroll-margin-top: 15rem;
  position: relative;
  @include hideScrollbars;

  @include allPhones {
    padding: 0 1rem 4rem;
  }

  // ---------------------------------------------------------------------
  // The lyrics sit on a VEIL PLATE, never on the bare ground. The page ground
  // is grid paper WITH the memphis doodles, and text laid straight onto it is
  // unreadable wherever a shape passes under a line — the same call the folder
  // list, the chart rows and the now-playing source all make.
  //
  // Width is capped rather than filling the page: these are lines of text, and
  // a lyric line running the width of a 1440px window is a reading problem, not
  // a poster.
  // ---------------------------------------------------------------------
  .lyrics-plate {
    max-width: 54rem;
    padding: $small;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;

    @include allPhones {
      padding: $smaller;
    }
  }

  // A synced line is a SEEK TARGET, so it is a <button>: reachable by keyboard,
  // announced as an action. The timestamp pill is what says so on screen — the
  // old view gave no sign at all that clicking a line jumps there.
  .line {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: $small;
    // NOT baseline: the pill is a box with its own frame, and a box set on the
    // lyric's baseline hangs below the words — its centre sat 4px under the
    // line it labels, halfway down to the scrubber (reported 2026-11-14). It is
    // centred on the FIRST line of the lyric instead (see .stamp), so a lyric
    // that wraps keeps its pill beside its opening words.
    align-items: start;
    // One line of lyric, so the pill can centre on it. Restated with the font
    // size below; `lh` would read the pill's own line-height, not the lyric's.
    --lyric-lh: calc(1.55rem * 1.22);
    width: 100%;
    // EVERY line reserves what the current state paints — the frame (a
    // transparent border, like candy-row-base), the room the zigzag needs on
    // the leading edge, and the band the scrubber sits in. Reserving it only on
    // `.current` would shove the text sideways and grow the row on every line
    // change, which in a list that is already scrolling itself reads as a jump.
    padding: 0.42rem 0.7rem 0.95rem 1.3rem;
    border: $candy-border-w solid transparent;
    border-radius: $candy-radius-sm;
    background-color: transparent;
    font-family: inherit;
    font-size: 1.55rem;
    font-weight: 700;
    line-height: 1.22;
    text-align: left;
    color: $mem-content-text;
    cursor: pointer;

    @include allPhones {
      gap: $smaller;
      font-size: 1.2rem;
      --lyric-lh: calc(1.2rem * 1.22);
    }

    // Two steps, not the five-rung opacity ladder this view used to carry:
    // dimming is a state in this design, and "already sung" is the only state
    // a passed line has.
    &.seen {
      color: $mem-content-muted;
    }

    // The pointer flip is a cut, not a fade (styling.md): fill and text swap in
    // opposite directions, so a transition would have a grey mid-frame.
    @media (hover: hover) {
      &:hover:not(.current) {
        background-color: var(--mem-hover);
        border-color: $mem-line;
        color: var(--mem-hover-text);

        .stamp {
          background-color: transparent;
          border-color: var(--mem-hover-text);
          color: var(--mem-hover-text);
        }
      }
    }
  }

  .stamp {
    justify-self: start;
    // A floor, not a fixed width: past the hour formatSeconds returns
    // HH:MM:SS, and a fixed column would push the pill under the lyric. Every
    // line of a given track formats the same way, so the column stays even.
    min-width: 3.6rem;
    $stamp-h: 1.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: $stamp-h;
    margin-top: calc((var(--lyric-lh) - #{$stamp-h}) / 2);
    padding: 0 0.35rem;
    line-height: 1;
    background-color: $mem-panel;
    border: $mem-ring-w solid $mem-line;
    border-radius: $candy-radius-pill;
    font-size: 0.72rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: $mem-content-muted;
  }

  // "This line is playing" takes the app's ONE vocabulary for it
  // (mem-now-playing-row): yellow fill, ink frame, the zigzag on the leading
  // edge, sprinkle fading in at both edges. Geometry is NOT restated here —
  // every line already reserves it (see .line above).
  .line.current {
    @include mem-now-playing-row;
    color: $candy-black;
    box-shadow: mem-shadow(3px, 3px);

    // On the yellow fill the pill flips to ink: teal and coral both measure
    // under 3:1 there, ink measures 9.6:1 (styling.md contrast table).
    .stamp {
      background-color: $candy-black;
      border-color: $candy-black;
      color: $mem-panel-static;
    }

    .text {
      position: relative;
    }

    // How far into this line playback has run — drawn as the app already draws
    // progress (Volume/NowPlaying seek bars): teal fill on a blush track inside
    // an ink frame. The frame is the contrast edge; the fill carries identity.
    .text::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: -0.62rem;
      height: 8px;
      border: $mem-ring-w solid $candy-black;
      border-radius: $candy-radius-pill;
      background-color: $candy-pink;
      background-image: linear-gradient($mem-teal, $mem-teal);
      background-repeat: no-repeat;
      background-size: var(--line-progress, 0%) 100%;
    }

    // Word by word: what is still to come is held back, what has been sung
    // stands in full ink, and the word being sung right now carries the teal
    // marker. The marker is a fill plus a box-shadow spread, never padding —
    // it paints around the word without moving a single letter, so the line
    // never reflows while it is being sung. Spaces sit outside the word spans,
    // so the marker ends at the last letter.
    //
    // Contrast: the held-back words are ink at 60 %, which measures 3.8:1 on
    // the Memphis yellow (#f5b23c) — above the 3:1 this large bold text needs;
    // 50 % fell just under it (2.9:1). Ink on teal is the pairing the play
    // buttons already use.
    .word {
      opacity: 0.6;
      border-radius: 0.2em;
    }

    .word.sung,
    .word.singing {
      opacity: 1;
    }

    .word.singing {
      background-color: $mem-teal;
      box-shadow: 0 0 0 0.08em $mem-teal;
    }
  }

  // Unsynced lyrics cannot seek, so they must not look like a list of seek
  // targets: running text, one weight down, with real leading.
  .line-plain {
    // The UA gives <p> a 1em top AND bottom margin, and there is no global
    // reset for it here — left alone it would override the leading below and
    // pad both ends of the plate.
    margin: 0;
    padding: 0.15rem 0.7rem;
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.45;
    color: $mem-content-text;

    @include allPhones {
      font-size: 1.1rem;
    }
  }

  .copyright {
    width: fit-content;
    margin-top: $medium;
    padding: 0.35rem 0.7rem;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius-sm;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: $mem-content-muted;
  }

  .nolyrics {
    max-width: 32rem;
    padding: $large;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;

    .big {
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.25;
    }

    .sub {
      margin-top: $smaller;
      font-size: 0.95rem;
      color: $mem-content-muted;
    }
  }
}
</style>
