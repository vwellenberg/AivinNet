<template>
  <!-- A sentinel, not a button that happens to be at the end: what triggers the
       next page is this element COMING INTO VIEW (#142). -->
  <div ref="sentinel" style="height: 1px">
    <button v-if="show_text" class="btn-pill" @click="loadOnce">Load More</button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteUpdate } from "vue-router";

const props = defineProps<{
  show_text?: boolean;
  fetch_callback: () => Promise<void>;
  reset_callback?: () => Promise<void>;
  outside_route?: boolean;
}>();

// ---------------------------------------------------------------------------
// WHAT LOADS THE NEXT PAGE (#142).
//
// It used to be `onMounted`, which is not a statement about the reader at all —
// it fired whenever this component was created. And it was created constantly,
// because the hosts gave their fetcher item `id: Math.random()`: the virtual
// scroller identifies items by `id`, so every recomputation of the list handed
// the last entry a new identity and rebuilt it. Paging therefore hung on a
// remount forced by a random number (measured: one quick scroll over /artists
// re-ran 23 `btn-pop` animations, all of them off screen).
//
// The flip side was worse and quieter: hosts that already used a STABLE id
// (the playlist's track fetcher, the album page's "similar albums") mounted
// their fetcher once and never fetched again.
//
// So the trigger is now visibility, and the ids can be stable everywhere.
//
// ⚠️ Two things this has to get right, and both are easy to miss:
//
//   1. After a page is added the sentinel may still be in view — a tall window
//      shows more rows than one page brings. An observer does not fire again
//      for a state it is already in, so the list would stop until the reader
//      scrolls. Re-observing re-delivers the current state, which continues the
//      chain by itself.
//   2. That chain needs a brake. If a host keeps rendering the fetcher while
//      its callback adds nothing (end of list reached, request failed), the
//      re-observe loop would spin. It stops after CHAIN_LIMIT consecutive
//      automatic loads and only re-arms on a real intersection change —
//      i.e. the next time the reader scrolls it into view.
// ---------------------------------------------------------------------------

/** How far ahead of the edge to start loading. */
const ROOT_MARGIN = "400px";
/** Consecutive automatic loads before the chain re-arms on the reader. */
const CHAIN_LIMIT = 10;

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let busy = false;
let chained = 0;

async function loadOnce() {
  if (busy) return;
  busy = true;
  try {
    await props.fetch_callback();
  } finally {
    busy = false;
  }
}

async function onVisible() {
  if (busy) return;
  await loadOnce();

  // Still in view (see ⚠️ 1)? Re-observing hands us the current state again.
  if (chained < CHAIN_LIMIT && observer && sentinel.value) {
    chained += 1;
    observer.unobserve(sentinel.value);
    observer.observe(sentinel.value);
  }
}

onMounted(() => {
  if (!sentinel.value) return;

  // No IntersectionObserver (old WebView, a test environment): fall back to the
  // previous behaviour rather than never loading anything.
  if (typeof IntersectionObserver === "undefined") {
    loadOnce();
    return;
  }

  observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          onVisible();
        } else {
          // Out of view again: the reader is back in charge.
          chained = 0;
        }
      }
    },
    { rootMargin: ROOT_MARGIN }
  );

  observer.observe(sentinel.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

!props.outside_route &&
  onBeforeRouteUpdate(() => {
    if (!props.reset_callback) return;
    props.reset_callback();
  });
</script>
