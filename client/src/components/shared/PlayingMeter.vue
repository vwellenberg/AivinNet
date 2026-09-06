<template>
  <svg
    class="playing-meter"
    :class="{ paused: !playing }"
    viewBox="0 0 24 24"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : playing ? 'Now playing' : 'Paused'"
    :aria-hidden="decorative ? 'true' : undefined"
  >
    <defs>
      <!-- The LED grid. It sits FIXED in the icon while the bars scale beneath
           it, so the gaps stay put instead of travelling with the bar. -->
      <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect v-for="y in GAP_YS" :key="y" x="0" :y="y" width="24" :height="GAP" fill="#000" />
      </mask>
      <!-- One clip per bar. The animated rect lives in here; the coloured
           segments below stay put and the clip uncovers them from the bottom.
           That also gives the peak segment its behaviour for free: it can only
           show when the bar actually reaches the top. -->
      <clipPath v-for="(x, i) in BAR_X" :id="clipId(i)" :key="x">
        <rect class="bar" :class="`b${i + 1}`" :x="x" :y="TOP" :width="BAR_W" :height="H" />
      </clipPath>
    </defs>

    <g :mask="`url(#${maskId})`">
      <g v-for="(x, i) in BAR_X" :key="x" :clip-path="`url(#${clipId(i)})`">
        <rect
          v-for="(y, s) in SEG_YS"
          :key="y"
          :x="x"
          :y="y"
          :width="BAR_W"
          :height="PITCH"
          :class="s === SEG_YS.length - 1 ? 'peak' : 'seg'"
        />
      </g>
    </g>
  </svg>
</template>

<script lang="ts">
// Module scope on purpose: a counter declared inside <script setup> would run
// per instance and hand every meter the same id.
let seq = 0
</script>

<script setup lang="ts">
withDefaults(
  defineProps<{
    playing?: boolean
    /**
     * Silence it for assistive tech. Use wherever a second meter repeats what
     * the surrounding chrome already announces — the player bar states the
     * track and the transport state on its own, so a second "Now playing"
     * there is noise.
     */
    decorative?: boolean
  }>(),
  { playing: true, decorative: false }
)

// Chrome raster (#311): 24x24 box, ink from 3 to 21.
const TOP = 3
const H = 18
const SEGS = 4
const PITCH = H / SEGS // 4.5
const GAP = 1.2
const BAR_W = 3.4

// Four bars: three read sparse, five clog below 20px.
const BAR_X = [1.9, 7.5, 13.1, 18.7]

// Segment fills, bottom-up. The lit block is 3.3 x 3.4 — square on purpose, so
// the bar reads as a stack of the same tiles the rest of the design uses.
const SEG_YS = Array.from({ length: SEGS }, (_, s) => TOP + H - PITCH * (s + 1))

// Grid lines between the segments.
const GAP_YS = Array.from({ length: SEGS - 1 }, (_, i) => TOP + PITCH * (i + 1) - GAP / 2)

// Ids have to be unique per instance: the meter renders in the track row and in
// the player bar at the same time, and a duplicate id would make both of them
// reference the first mask in the document.
const uid = ++seq
const maskId = `pm-grid-${uid}`
const clipId = (i: number) => `pm-clip-${uid}-${i}`
</script>

<style lang="scss">
// Now-playing meter — replaces the 9-bar wave from #67 (see #357).
//
// The bars are FILLED closed shapes, so they follow the "fill only where the
// form is closed" half of the icon rule; they are <rect>, so the legacy
// `svg path:not([stroke])` guard never touches them.
//
// Colour is measured, not chosen (WCAG 1.4.11 wants 3:1 for graphics):
//   $mem-teal  on the yellow playing row = 1.24:1  -> unusable
//   $mem-coral on the yellow playing row = 1.98:1  -> unusable
//   ink        on the yellow playing row = 9.64:1
// So the body is `currentColor` (ink on a filled row, light on the dark ground)
// and only the peak carries an accent — overridable per context via --meter-peak,
// which is exactly what the track row does.
.playing-meter {
  display: block;
  width: 1.125rem;
  height: 1.125rem;

  .seg {
    fill: currentColor;
  }

  .peak {
    fill: var(--meter-peak, #{$mem-coral});
  }

  .bar {
    transform-box: fill-box;
    transform-origin: bottom;
    // Heights snap to 25/50/75/100%. With four segments anything else ends a
    // bar mid-block and leaves a sliced remnant.
    animation-timing-function: step-end;
    animation-iteration-count: infinite;
  }

  // Own sequence AND own duration per bar: identical timing makes four bars
  // pump in lockstep, which reads as a looping gif. Staggered like this the
  // pattern does not visibly repeat for ~40s.
  //
  // These durations are deliberately not in _motion.scss: that file holds the
  // interaction scale, and it says so — ambient loops are one-off character
  // pieces and folding them in would invite reuse.
  .b1 {
    animation-name: meter-a;
    animation-duration: 0.62s;
  }

  .b2 {
    animation-name: meter-b;
    animation-duration: 0.78s;
  }

  .b3 {
    animation-name: meter-c;
    animation-duration: 0.54s;
  }

  .b4 {
    animation-name: meter-d;
    animation-duration: 0.9s;
  }

  // Paused freezes mid-pose. Hiding it would reflow the row it sits in.
  &.paused .bar {
    animation-play-state: paused;
  }
}

@media (prefers-reduced-motion: reduce) {
  .playing-meter .bar {
    animation: none;
  }
}

@keyframes meter-a {
  0% {
    transform: scaleY(0.5);
  }

  16% {
    transform: scaleY(1);
  }

  33% {
    transform: scaleY(0.75);
  }

  50% {
    transform: scaleY(0.25);
  }

  66% {
    transform: scaleY(1);
  }

  83% {
    transform: scaleY(0.5);
  }
}

@keyframes meter-b {
  0% {
    transform: scaleY(1);
  }

  20% {
    transform: scaleY(0.5);
  }

  40% {
    transform: scaleY(0.75);
  }

  60% {
    transform: scaleY(0.25);
  }

  80% {
    transform: scaleY(0.75);
  }
}

@keyframes meter-c {
  0% {
    transform: scaleY(0.25);
  }

  14% {
    transform: scaleY(0.75);
  }

  28% {
    transform: scaleY(0.5);
  }

  42% {
    transform: scaleY(1);
  }

  57% {
    transform: scaleY(0.75);
  }

  71% {
    transform: scaleY(0.25);
  }

  85% {
    transform: scaleY(0.5);
  }
}

@keyframes meter-d {
  0% {
    transform: scaleY(0.75);
  }

  25% {
    transform: scaleY(0.25);
  }

  50% {
    transform: scaleY(1);
  }

  75% {
    transform: scaleY(0.5);
  }
}
</style>
