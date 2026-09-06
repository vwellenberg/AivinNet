<template>
  <!-- The tiles are the shared `StatItem` — same anatomy, same icon per kind
    as the charts screen. What is NOT reused is `Stats.vue` around them: it
    splits its list into "all but the last" and "the last", which is how the
    charts screen sets the top track apart. Four equal numbers have nothing to
    set apart, and the split showed up as a gap in the middle of the row. -->
  <div v-if="items.length" class="library-numbers">
    <StatItem
      v-for="item in items"
      :key="item.cssclass"
      :value="item.value"
      :text="item.text"
      :icon="item.cssclass"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

import { getStats } from "@/requests/stats";

import StatItem from "@/components/Stats/StatItem.vue";

interface StatItemData {
  cssclass: string;
  value: string;
  text: string;
}

/**
 * The numeric ones only. `/logger/stats` also returns "Top track this week"
 * with its cover — a recommendation, and the charts screen is where those
 * belong; here it would be the one entry that is not a number.
 */
const WANTED = ["trackcount", "streams", "playtime", "favorites"];

/**
 * Module-level, so it survives the component. This block mounts behind
 * `v-if="!hasQuery"`, which means it is destroyed and rebuilt on every search
 * and every clearing of the field — and `/logger/stats` aggregates the whole
 * play history, so re-issuing it per keystroke-pause is not a rounding error.
 * The numbers move once a day at most; a session's first answer is good enough
 * for the rest of it.
 */
/**
 * The PROMISE is cached, not its result: caching the result only starts
 * helping once the first response has landed, and two mounts inside that first
 * round trip would each fire the aggregation anyway.
 *
 * And it is cached for a MINUTE, not for the session. This block is destroyed
 * and rebuilt on every search and every clearing of the field, so an uncached
 * call would run a whole-history aggregation per pause in typing — but three
 * of the four tiles are "this week" values that move while you listen, and the
 * stats screen refetches on every mount. A session-long cache makes the two
 * screens contradict each other; a minute covers the typing and nothing else.
 */
const TTL = 60_000;
let pending: Promise<StatItemData[]> | null = null;
let fetchedAt = 0;

function loadStats(): Promise<StatItemData[]> {
  if (pending && Date.now() - fetchedAt < TTL) return pending;

  fetchedAt = Date.now();

  // `mine` so a settled request only ever clears ITS OWN entry: a slow call
  // that resolves after the TTL has already started a second one would
  // otherwise wipe the newer promise out of the cache, and the mount after
  // that would fire a third aggregation.
  const mine: Promise<StatItemData[]> = getStats()
    .then(res => {
      if (res.status !== 200) throw new Error(`stats: ${res.status}`);

      const stats: StatItemData[] = res.data?.stats || [];
      // Ordered by WANTED rather than by the response, so the row reads the
      // same whatever order the backend happens to send.
      const wanted = WANTED.map(kind => stats.find(s => s.cssclass === kind)).filter(
        (s): s is StatItemData => Boolean(s)
      );

      // An empty answer is not an answer worth keeping: a 200 that carried
      // none of the four would otherwise pin the block shut until the TTL.
      if (!wanted.length && pending === mine) pending = null;

      return wanted;
    })
    .catch(() => {
      if (pending === mine) pending = null;
      return [];
    });

  pending = mine;
  return mine;
}

const items = ref<StatItemData[]>([]);

onMounted(async () => {
  items.value = await loadStats();
});
</script>

<style lang="scss">
.library-numbers {
  display: flex;
  gap: $medium;
  // The tiles scroll sideways on a narrow window rather than shrinking below
  // what their numbers need — the same answer the charts row gives, minus its
  // scrollbar (it would sit on top of the tiles).
  overflow-x: auto;
  // The offset shadow falls to the BOTTOM AND THE RIGHT, and `overflow-x`
  // clips both (it makes overflow-y compute to `auto` too) — scrolled to the
  // end, the last tile lost its right edge. Same reservation `.tabheaders`
  // makes for the search chips, same trap styling.md records for #399.
  padding: 0 $small $small 0;
  @include hideScrollbars;

  .statitem {
    flex-shrink: 0;
  }
}
</style>
