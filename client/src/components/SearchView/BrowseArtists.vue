<template>
  <!-- A failed load says so and offers the retry, rather than leaving the
    block silently absent: the store already knew, and nobody read it. The
    band is an extra, so the notice is one quiet line, not an alarm.
    Only when there is nothing to show: a refresh that fails after the store's
    TTL still has the whole list in hand, and replacing a working band with an
    error is a worse answer than keeping the band. -->
  <div v-if="browse.failed && !browse.artists.length" class="browse-notice">
    <span>Could not load the artist list.</span>
    <button type="button" class="retry" :disabled="browse.loading" @click="browse.fetchArtists()">
      Try again
    </button>
  </div>

  <!-- The first load has nothing to render yet, and the column would sit blank
    until it lands. One line rather than a skeleton: the band is an extra, and
    a shape that pretends to be content is worse than a sentence that is. -->
  <div v-else-if="browse.loading && !browse.artists.length" class="browse-notice">
    <span>Loading your library…</span>
  </div>

  <div v-else-if="browse.artists.length" class="browse-artists">
    <!-- The band sits on a plate: it is a row of small controls on the doodled
      ground, and the ground is exactly what makes a 2.4rem key unreadable
      (styling.md). The card row below brings its own plates per tile. -->
    <div class="band-plate">
      <div class="band" role="group" aria-label="Browse artists by first letter">
        <button
          v-for="key in LETTERS"
          :key="key"
          type="button"
          class="band-key"
          :class="{ on: browse.letter === key, off: !browse.counts[key] }"
          :aria-disabled="!browse.counts[key]"
          :aria-pressed="browse.letter === key"
          :title="bandTitle(key)"
          @click="browse.selectLetter(key)"
        >
          <span class="k">{{ key }}</span>
          <!-- The count is what turns the band from navigation into an answer:
            it says how much is behind a key BEFORE it is pressed. Absent keys
            stay visible and disabled rather than disappearing, so the band
            keeps one shape across libraries. -->
          <span v-if="browse.counts[key]" class="n">{{ browse.counts[key] }}</span>
        </button>
      </div>
    </div>

    <!-- `route` is what makes CardScroller show its SEE ALL link. It lands on
      the full artist list, NOT on this letter — the list has no letter filter,
      so this is a way out of the row, not a way to the rest of the letter. The
      label is left at the role's default; passing text replaces the whole
      label rather than adding to it. -->
    <CardScroller :title="rowTitle" :items="items" :route="artistListRoute" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";

import useBrowseStore, { LETTERS } from "@/stores/searchBrowse";

import CardScroller from "@/components/shared/CardScroller.vue";

const browse = useBrowseStore();

const items = computed(() => browse.shown.map(item => ({ type: "artist", item })));

// The caption names the kind and the selection — NOT the group size. The row
// shows as many cards as its grid has columns, so a "· 180" here would be a
// number the row visibly does not keep. The count belongs on the key, where it
// is a promise about what pressing it selects, and the row's SEE ALL is the
// way onwards.
const rowTitle = computed(() => `Artists · ${browse.letter}`);

const artistListRoute = "/artists";

function bandTitle(key: string) {
  const count = browse.counts[key];
  if (!count) return `No artists under ${key}`;
  return `${count} ${count === 1 ? "artist" : "artists"} under ${key}`;
}

onMounted(browse.fetchArtists);
</script>

<style lang="scss">
// Text on the doodled ground needs a plate like any other (styling.md).
.browse-notice {
  display: flex;
  align-items: center;
  gap: $small;
  width: fit-content;
  padding: $small $medium;
  background-color: var(--mem-veil);
  border: $candy-border;
  border-radius: $candy-radius;
  @include candy-shadow;
  color: $mem-content-text;
  font-size: 0.9rem;

  .retry {
    @include btn-pill($radius: $candy-radius-pill, $fill: $mem-panel);
    color: $mem-content-text;
    flex-shrink: 0;
  }
}

.browse-artists {
  // No horizontal padding of its own: the idle column owns the page indent,
  // so all three blocks stand on ONE left edge. Measured, not assumed — the
  // host and the recent-searches block both carried $padleft before this.
  .band-plate {
    padding: $small;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;
  }

  .band {
    display: flex;
    flex-wrap: wrap;
    // The offset shadow falls to the bottom and the right of every key, so the
    // gap has to clear those 3px — otherwise a wrapped second row reads as
    // touching the first. ($smaller + 3px would be a Sass unit error: rem and
    // px do not add.)
    gap: $small;
  }

  // A key is a pill like every other small control here, but square-ish rather
  // than wide: it carries one character, and a 44px-wide pill per letter would
  // make the band wider than the page on a phone. The 44px target is kept on
  // the axis it can be kept on — see the touch branch below.
  .band-key {
    @include btn-pill($h: 2.25rem, $radius: $candy-radius-pill, $fill: $candy-pink-soft);
    min-width: 2.25rem;
    padding: 0 0.5rem;
    gap: 0.2rem;
    color: $candy-text;
    font-size: 0.85rem;

    .n {
      font-size: 0.68rem;
      font-weight: 500;
      opacity: 0.65;
    }

    // Static blush -> static ink, in both themes.
    &.on {
      background-color: $candy-pink;
      color: $mem-ink;

      .n {
        opacity: 0.8;
      }
    }

    // An empty letter is shown and disabled, not hidden: the band is easier to
    // aim at when its keys never move. No shadow, because nothing here is
    // raised — it cannot be pressed.
    //
    // `aria-disabled`, not the `disabled` ATTRIBUTE (see the template): a
    // disabled control is not hit-tested at all, so its title never appears —
    // and "No artists under Z" is the one thing a greyed key has to be able to
    // say. It also drops out of the tab order, which makes a third of the band
    // unreachable by keyboard. The press is a no-op in the store instead.
    &.off {
      opacity: 0.4;
      box-shadow: none;
      cursor: default;

      &:hover {
        background-color: $candy-pink-soft;
        color: $candy-text;
        transform: none;
      }
    }
  }

  // Touch has no aim assist, so the key grows to the app's 44px floor there.
  // Gated on POINTER, not on width (styling.md: a narrow desktop window is not
  // a touch device and a touch tablet is not narrow) — and only the two numbers
  // change, so the role stays the one source for everything else.
  @media (hover: none) {
    .band-key {
      height: 2.75rem;
      min-width: 2.75rem;
    }
  }

}
</style>
