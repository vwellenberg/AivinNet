<template>
  <section v-if="dialIsWorthShowing(stations)" class="radio-card">
    <div class="radio-title"><b>AivinNet FM</b></div>

    <!-- Display and scale side by side, like a car radio: the readout on the
         left, the band on the right. On a phone they stack. -->
    <div class="radio-body">
    <!-- The readout: the station under the needle, big. It follows a drag, and
         the scale names no station, so nothing on it can overlap. -->
    <div class="radio-display" aria-hidden="true">
      <span class="radio-display-name">{{ readout.name }}</span>
      <span class="radio-display-kind">{{ readout.kind }}</span>
    </div>

    <div
      ref="dial"
      class="radio-dial"
      :class="{ 'is-still': still, 'is-dragging': drag !== null }"
      role="slider"
      tabindex="0"
      aria-label="AivinNet FM"
      :aria-valuemin="1"
      :aria-valuemax="stations.length"
      :aria-valuenow="index + 1"
      :aria-valuetext="valueText"
      @keydown="onKey"
      @wheel="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div ref="scale" class="radio-scale" aria-hidden="true">
        <span class="radio-line"></span>
        <span
          v-for="(station, i) in stations"
          :key="station.id"
          class="radio-tick"
          :class="{ 'is-tuned': i === tuned }"
          :style="{ left: pct(i) }"
        ></span>
        <span
          v-for="i in labelled"
          :key="'label-' + stations[i].id"
          class="radio-label"
          :class="{ 'is-tuned': i === tuned }"
          :style="{ left: pct(i) }"
        >{{ frequencyOf(i) }}</span>
        <span class="radio-needle" :style="{ left: pct(position) }"></span>
      </div>
    </div>
    </div>

    <!-- For screen readers: the display already says it on screen. -->
    <p class="radio-status" aria-live="polite">{{ statusText }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { getStations } from '@/requests/home'
import { crackle, muteForTuning, resumeMusic, tuneStation } from '@/helpers/radio'
import useHome from '@/stores/home'
import { useElementSize } from '@vueuse/core'
import {
  dragPosition,
  frequencyLabelWidth,
  keyTarget,
  labelEvery,
  prefersReducedMotion,
  snapIndex,
  stationFraction,
  stationFrequency,
  stationReadout,
  dialIsWorthShowing,
  stationsFromList,
  wheelSteps,
} from '@/utils/radioDial'
import type { Station } from '@/utils/radioDial'

// INFO: AivinNet FM (#542, #640), a dial on Home between the continue cards
// and the rows. A station is a generated playlist, and the server lists the
// ones the user has in dial order: the mixes, the genre stations and the
// decade stations (`GET /nothome/stations`). Home's refresh asks again.

const home = useHome()
const stations = ref<Station[]>([])

async function loadStations() {
  try {
    stations.value = stationsFromList(await getStations())
  } catch {
    // The dial is an extra on Home: when the list cannot be had, there is no dial.
    stations.value = []
  }
}

const dial = ref<HTMLElement>()
const scale = ref<HTMLElement>()
// The scale's width decides how many frequency labels fit (`labelEvery`).
const { width: scaleWidth } = useElementSize(scale)
// The station the needle rests on, and the station that is playing.
const index = ref(0)
const tuned = ref(-1)
// The needle while a drag is on; equals `index` otherwise.
const position = ref(0)
const drag = ref<{ id: number; startX: number; start: number; width: number; last: number } | null>(null)
let wheelRest = 0
// Less motion: the needle jumps. Read once, on mount, like the other motion checks.
const still = ref(false)

onMounted(() => {
  still.value = prefersReducedMotion()
  void loadStations()
})

watch(
  () => home.homepageItems,
  () => void loadStations()
)

watch(
  () => stations.value.length,
  count => {
    index.value = snapIndex(index.value, count)
    position.value = index.value
    if (tuned.value >= count) tuned.value = -1
  }
)

const valueText = computed(() => {
  const station = stations.value[index.value]
  return station ? stationReadout(station, index.value, stations.value.length).valueText : ''
})

const statusText = computed(() => {
  const station = stations.value[tuned.value]
  return station
    ? `Tuned in: ${stationReadout(station, tuned.value, stations.value.length).valueText}`
    : 'Turn the dial to tune in'
})

// The display shows the station under the needle: the one tuned in, or the
// one a drag is passing over.
const readout = computed(() => {
  const count = stations.value.length
  const at = snapIndex(position.value, count)
  const station = stations.value[at]
  return station ? stationReadout(station, at, count) : { name: '', kind: '', valueText: '' }
})

function pct(i: number): string {
  return `${stationFraction(i, stations.value.length) * 100}%`
}

function frequencyOf(i: number): string {
  return stationFrequency(i, stations.value.length)
}

// The stations that carry a frequency label: every k-th, so the labels that are
// shown never overlap at this width. The scale's font is the label's font.
const labelled = computed(() => {
  const count = stations.value.length
  const fontPx = parseFloat(scale.value ? getComputedStyle(scale.value).fontSize : '') || 12
  const every = labelEvery(scaleWidth.value, count, frequencyLabelWidth(fontPx))
  return stations.value.map((_, i) => i).filter(i => i % every === 0)
})

/** Move the needle to station `to` and tune it in, unless it already plays. */
function land(to: number) {
  index.value = to
  position.value = to
  if (to === tuned.value) {
    resumeMusic()
    return
  }
  tuned.value = to
  void tuneStation(stations.value[to])
}

function onKey(event: KeyboardEvent) {
  const to = keyTarget(event.key, index.value, stations.value.length)
  if (to === null) return
  event.preventDefault()
  land(to)
}

function onWheel(event: WheelEvent) {
  // The dial sits in the middle of Home: a wheel passing over it must keep
  // scrolling the page. It tunes only once the dial is focused (a click or Tab).
  if (document.activeElement !== dial.value) return
  event.preventDefault()
  const { steps, rest } = wheelSteps(event.deltaY, wheelRest)
  wheelRest = rest
  if (steps === 0) return
  const to = snapIndex(index.value + steps, stations.value.length)
  if (to !== index.value) land(to)
}

function onDown(event: PointerEvent) {
  if (stations.value.length === 0 || event.button > 0) return
  const track = scale.value
  if (!track) return
  dial.value?.setPointerCapture?.(event.pointerId)
  drag.value = {
    id: event.pointerId,
    startX: event.clientX,
    start: index.value,
    width: track.clientWidth,
    last: index.value,
  }
  // The music goes quiet while the needle is between stations.
  muteForTuning()
}

function onMove(event: PointerEvent) {
  const current = drag.value
  if (!current || event.pointerId !== current.id) return
  const count = stations.value.length
  const at = dragPosition(current.start, event.clientX - current.startX, current.width, count)
  position.value = at
  const snapped = snapIndex(at, count)
  if (snapped !== current.last) {
    current.last = snapped
    crackle()
  }
}

function onUp(event: PointerEvent) {
  const current = drag.value
  if (!current || event.pointerId !== current.id) return
  drag.value = null
  dial.value?.releasePointerCapture?.(event.pointerId)
  land(snapIndex(position.value, stations.value.length))
}
</script>

<style lang="scss">
.radio-card {
  // The page's own edge, like the Browse tiles above the rows.
  padding: 0 0 1.5rem;

  .radio-title {
    @include mem-sticker;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }

  // One raised plate, so the dial reads as a control of the page. Its height
  // is the touch target: 4rem, well above 44 px.
  .radio-dial {
    position: relative;
    height: 4rem;
    touch-action: none;
    user-select: none;
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius-sm);
    @include candy-raised(3px, 3px, $press: false);
    cursor: grab;

    &:focus-visible {
      @include focus-ring;
    }

    &.is-dragging {
      cursor: grabbing;
    }
  }

  // Readout beside the band (user, 2026-10-31: a full-width readout left a
  // long empty plate on a desktop). Both rows share the dial's 4rem height.
  .radio-body {
    display: grid;
    grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
    gap: 0.75rem;
    align-items: stretch;

    @include allPhones {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  // The readout: the tuned station, big, on its own plate. The same plate as
  // the dial, so it reads as part of the same set.
  .radio-display {
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius-sm);
    @include candy-raised(3px, 3px, $press: false);
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 4rem;
    padding: 0.4rem 1rem;
  }

  .radio-display-name {
    min-width: 0;
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: $mem-content-text;
  }

  .radio-display-kind {
    margin-top: 0.15rem;
    font-size: $medium;
    font-weight: 600;
    letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums;
    color: $mem-content-text;
  }

  // The scale spans the dial between 1.5rem gutters; stations sit on it in %.
  // Its font is the frequency labels' font.
  .radio-scale {
    position: absolute;
    left: 1.5rem;
    right: 1.5rem;
    top: 0;
    bottom: 0;
    font-size: $medium;
  }

  .radio-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 1.25rem;
    height: $mem-ring-w;
    background: $mem-line;
  }

  .radio-tick {
    position: absolute;
    top: calc(1.25rem - 6px);
    width: $mem-ring-w;
    height: 12px;
    margin-left: -($mem-ring-w / 2);
    background: $mem-line;

    &.is-tuned {
      background: $mem-lavender;
    }
  }

  // Centred on its tick: a label is as wide as its estimate (`frequencyLabelWidth`).
  .radio-label {
    position: absolute;
    top: 2.1rem;
    transform: translateX(-50%);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: $mem-content-text;

    &.is-tuned {
      color: $mem-lavender;
    }
  }

  // Purple, the Frequenz colour. Its transition is the only motion; under
  // "less motion" the needle jumps (`is-still`).
  .radio-needle {
    position: absolute;
    top: 0.5rem;
    height: 1.5rem;
    width: $candy-border-w;
    margin-left: -($candy-border-w / 2);
    background: $mem-lavender;
    transition: left $motion-move ease-out;
  }

  .radio-dial.is-still .radio-needle,
  .radio-dial.is-dragging .radio-needle {
    transition: none;
  }

  // Read out to screen readers only: on screen the display says the same.
  .radio-status {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
}
</style>
