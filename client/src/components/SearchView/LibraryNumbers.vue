<template>
  <!-- The row is the charts screen's own `Stats.vue`, handed the tiles through
    `items` — with them it fetches nothing and shows no date range, so this
    block keeps its cached answer and its four numbers (see WANTED below).
    It used to lay the tiles out itself, and on a phone the row simply ended
    in a cut-off tile: no fade at the edge, no arrow, unlike the same tiles on
    the charts screen (user, 2026-11-18). One row, one anatomy. -->
  <div v-if="items.length" class="library-numbers">
    <Stats :items="items" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

import { getStats } from "@/requests/stats";

import Stats from "@/components/Stats/Stats.vue";

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
// Scrolling, fade and arrows come with `Stats.vue`. Only the top inset goes:
// the idle column already spaces its blocks (`.search-idle`, 2rem), and the
// row's own 1rem above the tiles doubled it. The bottom inset stays — it holds
// the tiles' offset shadow inside the scroller.
.library-numbers .statshead {
  padding-top: 0;
}
</style>
