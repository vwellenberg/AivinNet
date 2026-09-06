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
          <span class="text">{{ line.text }}</span>
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
import formatSeconds from "@/utils/useFormatSeconds";
import updatePageTitle from "@/utils/updatePageTitle";

const queue = useQueue();
const lyrics = useLyrics();
const settings = useSettings();

const hasLyrics = computed(() => !!lyrics.lyrics && lyrics.lyrics.length > 0);

/**
 * How far playback has run INTO the current line, 0 → 1.
 *
 * The line's own timestamp is its start; the next line's is its end. The last
 * line has no successor, so it ends with the track — and if the duration is not
 * known yet, it stays at 0 rather than jumping to full.
 */
const lineProgress = computed(() => {
  const index = lyrics.currentLine;
  const lines = lyrics.lyrics;

  if (!lyrics.synced || index < 0 || index >= lines.length) return 0;

  const start = lines[index].time;
  const end =
    index + 1 < lines.length
      ? lines[index + 1].time
      : queue.duration.full * 1000;

  if (!(end > start)) return 0;

  const millis = queue.duration.current * 1000;
  return Math.min(Math.max((millis - start) / (end - start), 0), 1);
});

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
    align-items: baseline;
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
    padding: 0.1rem 0.35rem;
    text-align: center;
    background-color: $mem-panel;
    border: 2px solid $mem-line;
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
    box-shadow: 3px 3px 0 var(--mem-shadow);

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
      border: 2px solid $candy-black;
      border-radius: $candy-radius-pill;
      background-color: $candy-pink;
      background-image: linear-gradient($mem-teal, $mem-teal);
      background-repeat: no-repeat;
      background-size: var(--line-progress, 0%) 100%;
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
