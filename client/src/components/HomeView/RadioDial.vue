<template>
  <section v-if="dialIsWorthShowing(stations)" class="radio-card">
    <div class="radio-title"><b>Subspace radio</b></div>

    <div
      ref="dial"
      class="radio-dial"
      :class="{ 'is-still': still, 'is-dragging': drag !== null }"
      role="slider"
      tabindex="0"
      aria-label="Subspace radio"
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
          v-for="(station, i) in stations"
          :key="'label-' + station.id"
          class="radio-label"
          :class="{ 'is-tuned': i === tuned }"
          :style="{ left: pct(i), transform: `translateX(${labelShift(i)})` }"
        >{{ station.name }}</span>
        <span class="radio-needle" :style="{ left: pct(position) }"></span>
      </div>
    </div>

    <p class="radio-status" aria-live="polite">{{ statusText }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { getStations } from '@/requests/home'
import { crackle, muteForTuning, resumeMusic, tuneStation } from '@/helpers/radio'
import useHome from '@/stores/home'
import {
  dragPosition,
  keyTarget,
  prefersReducedMotion,
  snapIndex,
  stationFraction,
  dialIsWorthShowing,
  stationsFromList,
  wheelSteps,
} from '@/utils/radioDial'
import type { Station } from '@/utils/radioDial'

// INFO: Subspace radio (#542, #640), a dial on Home between the continue cards
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

const valueText = computed(() => stations.value[index.value]?.name ?? '')

const statusText = computed(() => {
  const station = stations.value[tuned.value]
  return station ? `Tuned in: ${station.name}` : 'Turn the dial to tune in'
})

function pct(i: number): string {
  return `${stationFraction(i, stations.value.length) * 100}%`
}

function labelShift(i: number): string {
  const count = stations.value.length
  if (count <= 1) return '-50%'
  if (i === 0) return '0'
  if (i === count - 1) return '-100%'
  return '-50%'
}

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

  // The scale spans the dial between 1.5rem gutters; stations sit on it in %.
  .radio-scale {
    position: absolute;
    left: 1.5rem;
    right: 1.5rem;
    top: 0;
    bottom: 0;
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

  .radio-label {
    position: absolute;
    top: 2.1rem;
    font-size: $medium;
    font-weight: 600;
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

  .radio-status {
    margin-top: 0.5rem;
    font-size: $medium;
    color: $mem-content-text;
  }
}
</style>
