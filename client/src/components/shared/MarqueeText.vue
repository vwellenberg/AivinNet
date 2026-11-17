<template>
  <div ref="box" class="marquee" :class="{ 'is-running': running }" :style="runStyle">
    <!-- One copy of the text, never a duplicate for the loop: a screen reader
         reads the slot once, and the scroll is a transform on this one span. -->
    <span ref="content" class="marquee-text"><slot /></span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

// A single line of text that scrolls sideways when it does not fit, instead of
// ending in "…" where the title is most likely to be cut off (the player plate
// on a phone, the player bar on desktop).
//
// JavaScript only MEASURES. It decides whether the text overflows and writes two
// custom properties; the movement is a CSS keyframe animation on the span, so the
// browser runs it on the compositor and no frame is produced by script. A
// `requestAnimationFrame` loop would stall with the single-threaded server's
// main-thread work and read as a jerk on every busy frame.

const props = defineProps<{
  /** The text as it reads, used only to re-measure when the content changes. */
  text?: string;
}>();

const box = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);

const running = ref(false);
const shift = ref(0);
const duration = ref(0);

// Pixels of text beyond the box, plus the soft edge at each end. The mask fades
// the edges while the text moves, and the padding keeps the first and last
// letters out of the fade when the text is at rest at either end.
const EDGE = 12;
// Speed of the moving part, in px per second. The keyframes spend 70% of each
// pass moving and 30% holding at the two ends, so a pass lasts shift / (0.7 * speed).
const SPEED = 30;
// A short overflow would otherwise scroll so fast it reads as a blink.
const MIN_DURATION = 6;

const runStyle = computed(() =>
  running.value
    ? {
        "--marquee-shift": `${shift.value}px`,
        "--marquee-duration": `${duration.value}s`,
      }
    : undefined,
);

// Read live, not cached: a user can switch the OS setting while the page is open,
// and the answer has to follow it without a reload.
const reducedQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const reduced = () => reducedQuery?.matches ?? false;

function measure() {
  const boxEl = box.value;
  const textEl = content.value;
  if (!boxEl || !textEl) return;

  // The natural width, not the current one: a fitting span is block-sized to the
  // box, and an ArtistName inside it is clamped to the box by its own max-width.
  // Setting the width for one synchronous read, then clearing it, never paints,
  // so it costs a reflow and no flicker.
  textEl.style.width = "max-content";
  textEl.style.paddingInline = "0";
  const natural = textEl.scrollWidth;
  textEl.style.width = "";
  textEl.style.paddingInline = "";

  const available = boxEl.clientWidth;
  const overflows = natural > available;

  if (!overflows || reduced()) {
    running.value = false;
    return;
  }

  shift.value = Math.ceil(natural + EDGE * 2 - available);
  duration.value = Math.max(MIN_DURATION, shift.value / SPEED / 0.7);
  running.value = true;
}

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

function onMotionChange() {
  measure();
}

onMounted(() => {
  measure();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => measure());
    if (box.value) resizeObserver.observe(box.value);
    if (content.value) resizeObserver.observe(content.value);
  }

  // The slot can change without the box or the span changing size (a new track
  // with a same-length title), so the DOM itself is watched too.
  if (typeof MutationObserver !== "undefined" && content.value) {
    mutationObserver = new MutationObserver(() => measure());
    mutationObserver.observe(content.value, { childList: true, characterData: true, subtree: true });
  }

  reducedQuery?.addEventListener?.("change", onMotionChange);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  reducedQuery?.removeEventListener?.("change", onMotionChange);
});

watch(
  () => props.text,
  async () => {
    // Drop the loop first, so the next measure starts it again from the left
    // edge. Otherwise a new track arrives partway through the old scroll.
    running.value = false;
    await nextTick();
    measure();
  },
);
</script>

<style lang="scss">
// Cut-off text in the player scrolls; everywhere else it ends in an ellipsis.
// Not in the song lists: a row of scrolling titles is too much motion there.
//
// Fits: the span is block-sized to the box with the ellipsis, exactly the
// one-line `.ellip` look, with no animation and no mask.
// Overflows: the running state adds the keyframe loop and the soft edges. The
// `--marquee-shift` and `--marquee-duration` values come from the script above.
.marquee {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;

  .marquee-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.is-running {
    // Both ends fade, not just the one the text disappears into: at rest the
    // text sits at the left edge, and the fade there is covered by the padding.
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);

    .marquee-text {
      width: max-content;
      overflow: visible;
      text-overflow: clip;
      padding-inline: 12px;
      // The loop is a transform, which the compositor handles alone. The
      // duration is the one value JS computes, so the stylesheet names no
      // number of its own.
      animation: marquee-sway var(--marquee-duration) linear infinite alternate;
    }
  }
}

// Holds at both ends (0–15 % and 85–100 %) so the start and the finish are read
// before the text moves on. `alternate` runs the same keyframes back.
@keyframes marquee-sway {
  0%,
  15% {
    transform: translateX(0);
  }
  85%,
  100% {
    transform: translateX(calc(-1 * var(--marquee-shift)));
  }
}
</style>
