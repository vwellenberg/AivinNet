<template>
  <section v-if="dialIsWorthShowing(stations)" class="radio-card">
    <!-- One housing, one plate: it arrives as a whole, its parts get no arrival
         of their own (styling.md, "Eine segmentierte Leiste kommt als EIN Objekt"). -->
    <!-- The housing's own surface opens and closes it too (a pointer
         convenience; the button is the control for keyboards and readers). -->
    <div class="radio-case" :class="{ 'is-still': still, 'is-open': open }" @click="onCaseClick">
      <div class="radio-head">
        <div class="radio-title"><b>AivinNet FM</b></div>
        <!-- Folded: the strip says the radio plays, and nothing else. -->
        <span v-if="!open && onAirStation" class="radio-onair" aria-hidden="true">
          <i class="radio-onair-lamp"></i>ON AIR · {{ onAirStation }}
        </span>
        <div v-if="open" class="radio-legend" aria-hidden="true">
          <span v-for="kind in legend" :key="kind">
            <i :class="'kind-' + kind"></i>{{ KIND_LABEL[kind] }}
          </span>
          <span class="radio-band-range">FM 87.5–108</span>
        </div>
        <button
          type="button"
          class="radio-toggle"
          :class="{ 'is-open': open }"
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="open ? 'radio-body' : undefined"
          :aria-label="open ? 'Close radio' : 'Open radio'"
          @click.stop="toggleOpen"
        >
          <ExpandSvg />
        </button>
      </div>

      <div v-if="open" id="radio-body" class="radio-body">
        <!-- The readout: the station under the knob, big. It follows a drag. -->
        <!-- Not aria-hidden as a whole: the wide display's buttons must stay reachable. -->
        <div class="radio-display">
          <div class="radio-readout" aria-hidden="true">
            <div class="radio-top">
              <span
                v-if="display.station"
                class="radio-kind"
                :class="'kind-' + display.station.kind"
              >{{ KIND_LABEL[display.station.kind] }}</span>
              <span class="radio-air" :class="'is-' + air">
                <i class="radio-lamp"></i>
                <span>{{ airText }}</span>
                <span class="radio-signal">
                  <i v-for="n in 4" :key="n" :class="{ on: n <= bars }"></i>
                </span>
              </span>
            </div>
            <div class="radio-freq">{{ display.frequency }}<small>MHz</small></div>
            <div class="radio-name-row">
              <span class="radio-display-name">{{ display.station?.name ?? '' }}</span>
              <span class="radio-level" :class="{ 'is-on': air === 'on' }">
                <i v-for="n in 7" :key="n"></i>
              </span>
            </div>
          </div>
          <!-- Wide screens only (the container query in the styles): what plays now. -->
          <div class="radio-now">
            <!-- A faint spectrum behind the song: decoration, hidden from readers. -->
            <div v-show="nowOn" class="radio-spectrum" :class="{ 'is-live': nowOn }" aria-hidden="true">
              <i v-for="n in SPECTRUM_BARS" :key="n"></i>
            </div>
            <template v-if="nowOn">
              <img v-if="nowCover" class="radio-now-cover" :src="nowCover" alt="" loading="lazy" aria-hidden="true" />
              <div v-else class="radio-now-cover is-empty" aria-hidden="true"></div>
              <div class="radio-now-meta" aria-hidden="true">
                <span class="radio-now-label">NOW PLAYING</span>
                <span class="radio-now-title">{{ nowTrack?.title }}</span>
                <span class="radio-now-artist">{{ nowArtists }}</span>
                <span v-if="nowAlbum" class="radio-now-album">{{ nowAlbum }}</span>
              </div>
              <div class="radio-now-acts">
                <button
                  type="button"
                  class="radio-gbtn"
                  :class="{ 'is-on': nowFav }"
                  aria-label="Favorite"
                  :aria-pressed="nowFav ? 'true' : 'false'"
                  @click="toggleFav"
                >
                  <HeartFillSvg v-if="nowFav" />
                  <HeartOutlineSvg v-else />
                </button>
                <button type="button" class="radio-gbtn" aria-label="Next song" @click="queue.playNext()">
                  <NextSvg />
                </button>
              </div>
              <div class="radio-now-prog" aria-hidden="true">
                <span>{{ elapsedText }}</span>
                <span class="radio-now-bar"><i :style="{ width: progress + '%' }"></i></span>
                <span>{{ remainText }}</span>
              </div>
            </template>
            <span v-else-if="air !== 'on'" class="radio-now-idle">Turn the knob</span>
          </div>
        </div>

        <!-- The knob is THE slider: keyboard, wheel, pointer and screen readers use it. -->
        <div class="radio-knob" :class="{ 'is-still': still, 'is-tuning': drag !== null }">
          <div class="radio-knob-dial">
            <svg class="radio-bezel" viewBox="0 0 120 120" aria-hidden="true">
              <line
                v-for="tick in bezel"
                :key="tick.index"
                :x1="tick.x1"
                :y1="tick.y1"
                :x2="tick.x2"
                :y2="tick.y2"
                class="bt"
                :class="[tick.major ? 'is-major' : 'is-minor', { 'is-lit': tick.index === litTick }]"
              />
              <text x="60" y="116" text-anchor="middle">TUNING</text>
            </svg>
            <div
              ref="grip"
              class="radio-grip"
              :class="{ 'is-dragging': drag !== null }"
              role="slider"
              tabindex="0"
              aria-label="AivinNet FM"
              :aria-valuemin="1"
              :aria-valuemax="stations.length"
              :aria-valuenow="index + 1"
              :aria-valuetext="valueText"
              @keydown="onKey"
              @wheel="onWheel"
              @pointerdown="onKnobDown"
              @pointermove="onMove"
              @pointerup="onUp"
              @pointercancel="onUp"
            >
              <div class="radio-turn" :style="{ transform: knobTurn }">
                <svg class="radio-knob-svg" viewBox="0 0 100 100">
                  <circle class="k-panel" cx="50" cy="50" r="47" />
                  <circle class="k-ridge" cx="50" cy="50" r="43" stroke-width="7" stroke-dasharray="2.7 4.05" />
                  <circle class="k-ink" cx="50" cy="50" r="47" stroke-width="3" />
                  <circle class="k-panel" cx="50" cy="50" r="35" />
                  <circle class="k-ink" cx="50" cy="50" r="35" stroke-width="3" />
                  <circle class="k-ring" cx="50" cy="50" r="26" stroke-width="1.5" />
                  <circle class="k-ring k-ring-faint" cx="50" cy="50" r="17" stroke-width="1.5" />
                  <line class="k-ink" x1="50" y1="19" x2="50" y2="33" stroke-width="8.5" stroke-linecap="round" />
                  <line class="k-red" x1="50" y1="19" x2="50" y2="33" stroke-width="5" stroke-linecap="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- For screen readers: the display already says it on screen. -->
    <p class="radio-status" aria-live="polite">{{ statusText }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import ExpandSvg from '@/assets/icons/expand.svg'
import HeartFillSvg from '@/assets/icons/heart.fill.svg'
import HeartOutlineSvg from '@/assets/icons/heart.svg'
import NextSvg from '@/assets/icons/next.svg'
import { favType } from '@/enums'
import { paths } from '@/config'
import favoriteHandler from '@/helpers/favoriteHandler'
import { crackle, muteForTuning, resumeMusic, tuneStation } from '@/helpers/radio'
import useFavorites from '@/stores/favorites'
import useHome from '@/stores/home'
import useSettings from '@/stores/settings'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import { releaseYear } from '@/utils/dates'
import formatSeconds from '@/utils/useFormatSeconds'
import {
  AIR_TEXT,
  airState,
  BEZEL_TICK_COUNT,
  bezelTick,
  dialIsWorthShowing,
  KIND_LABEL,
  keyTarget,
  knobAngle,
  knobDragPosition,
  KNOB_PX_PER_STATION,
  kindsOnDial,
  litBezelTick,
  playsStation,
  prefersReducedMotion,
  snapIndex,
  stationFrequency,
  stationReadout,
  stationsFromList,
  signalBars,
  wheelSteps,
} from '@/utils/radioDial'
import type { Station } from '@/utils/radioDial'

// INFO: AivinNet FM (#542, #640), a dial on Home between the continue cards
// and the rows. A station is a generated playlist, and the server lists the
// ones the user has in dial order: the mixes, the genre stations and the
// decade stations. The list comes with the rows, in Home's own answer (#776):
// the dial is there when the rows are, and pushes nothing down.

const home = useHome()
const queue = useQueue()
const tracklist = useTracklist()
const settings = useSettings()
// Folded by default (Home declutter, 2026-11-15); the choice is per device.
const open = computed(() => settings.radio_open)
/**
 * A click on the housing's bare surface (the head strip, the margins) toggles
 * it. Inside the body it does nothing: tuning on the knob, or a tap on the
 * display, must never fold the radio away.
 */
function onCaseClick(event: MouseEvent) {
  const target = event.target as Element | null
  if (target?.closest('.radio-body')) return
  // The end of a drag that selected the title or the legend is a click too.
  if (window.getSelection?.()?.isCollapsed === false) return
  toggleOpen()
}

function toggleOpen() {
  // Folding mid-drag removes the knob under the pointer, so its pointerup
  // never comes: end the drag here, unmute, keep the station.
  if (drag.value !== null) {
    drag.value = null
    dragTarget = null
    position.value = index.value
    resumeMusic()
  }
  settings.setRadioOpen(!settings.radio_open)
}
const stations = ref<Station[]>(stationsFromList(home.stations))

/**
 * Put a new list on the dial and keep the station the dial rests on and the
 * one playing by their ids: a season's station shifts every index after it.
 */
function setStations(list: Station[]) {
  const tunedId = stations.value[tuned.value]?.id
  const restingId = stations.value[index.value]?.id
  stations.value = list
  const at = (id: string | undefined) => (id === undefined ? -1 : list.findIndex(station => station.id === id))
  tuned.value = at(tunedId)
  const resting = at(restingId)
  index.value = resting >= 0 ? resting : snapIndex(index.value, list.length)
  if (drag.value === null) position.value = index.value
}

// The knob is the slider: its grip takes the keys, the wheel and the pointer.
const grip = ref<HTMLElement>()
// The station the dial rests on, and the station that is playing.
const index = ref(0)
const tuned = ref(-1)
// The dial position while a drag is on; equals `index` otherwise.
const position = ref(0)

// The element that holds the pointer during a drag. Kept out of reactivity:
// a Vue proxy of a DOM element cannot take its own method calls.
let dragTarget: HTMLElement | null = null
const drag = ref<{ id: number; startX: number; startY: number; start: number; last: number } | null>(null)
let wheelRest = 0
// Less motion: the knob turns without its swing. Read once, on mount, like the other motion checks.
const still = ref(false)

onMounted(() => {
  still.value = prefersReducedMotion()
  // Back on Home while a station plays (another page, a reload): the queue
  // still comes from its playlist, so the dial rests on it and the folded
  // strip says ON AIR. `tuned` alone lives only as long as this component.
  const playing = stations.value.findIndex(station => playsStation(tracklist.from, station.id))
  if (playing >= 0) {
    tuned.value = playing
    index.value = playing
    position.value = playing
  }
})

// A new list from Home's answer (a refetch, a season change): keep the station
// under the knob and the one playing by their ids (setStations).
watch(
  () => home.stations,
  list => setStations(stationsFromList(list))
)

watch(
  () => stations.value.length,
  count => {
    index.value = snapIndex(index.value, count)
    position.value = index.value
    if (tuned.value >= count) tuned.value = -1
  }
)

const count = computed(() => stations.value.length)

const valueText = computed(() => {
  const station = stations.value[index.value]
  return station ? stationReadout(station, index.value, count.value).valueText : ''
})

const statusText = computed(() => {
  const station = stations.value[tuned.value]
  return station
    ? `Tuned in: ${stationReadout(station, tuned.value, count.value).valueText}`
    : 'Turn the dial to tune in'
})

// The display shows the station under the knob: the one tuned in, or the
// one a drag is passing over.
const display = computed(() => {
  const at = snapIndex(position.value, count.value)
  const station = stations.value[at]
  return {
    station,
    frequency: station ? stationFrequency(at, count.value) : '',
    at,
  }
})

// What plays now: the queue's current track. Read from the list, not from
// `queue.currenttrack`, whose getter fires a favourite request on every read.
const nowTrack = computed(() => tracklist.tracklist[queue.currentindex] ?? null)
const nowCover = computed(() => {
  const image = nowTrack.value?.image
  return image && image !== 'None' ? paths.images.thumb.small + image : ''
})
const nowArtists = computed(() => (nowTrack.value?.artists ?? []).map(artist => artist.name).join(', '))
// "Album · 2019": the year leaves out when the track has no date (0 is unknown).
const nowAlbum = computed(() => {
  const track = nowTrack.value
  if (!track) return ''
  return [track.album, releaseYear(track.date ?? 0)].filter(Boolean).join(' · ')
})

// ON AIR only while the queue still plays the tuned station: an album started
// from its own page afterwards is not the radio, whatever `tuned` remembers.
const air = computed(() =>
  airState({
    tuned: tuned.value >= 0 && playsStation(tracklist.from, stations.value[tuned.value]?.id),
    playing: queue.playing,
    dragging: drag.value !== null,
  })
)
const airText = computed(() => AIR_TEXT[air.value])

// The now-playing zone is live only with a track to show; the spectrum runs
// exactly then. Read from the queue's own fields, not `queue.currenttrack`.
const nowOn = computed(() => air.value === 'on' && nowTrack.value !== null)
const SPECTRUM_BARS = 40
// The queue's clock: the player bar's seek bar reads the same two numbers.
const progress = computed(() => {
  const full = queue.duration.full
  if (!full) return 0
  return Math.min(100, Math.max(0, (queue.duration.current / full) * 100))
})
const elapsedText = computed(() => formatSeconds(queue.duration.current || 0))
const remainText = computed(() => `-${formatSeconds(Math.max(0, (queue.duration.full || 0) - (queue.duration.current || 0)))}`)
// The same favourite state the player bar shows: the registry first, then the copy.
const nowFav = computed(() => {
  const track = nowTrack.value
  if (!track) return false
  return useFavorites().flag(favType.track, track.trackhash) ?? track.is_favorite ?? false
})
function toggleFav() {
  const track = nowTrack.value
  if (!track) return
  void favoriteHandler(nowFav.value, favType.track, track.trackhash, () => null, () => null)
}
// The name of the station on air: the folded strip shows it.
const onAirStation = computed(() => (air.value === 'on' ? (stations.value[tuned.value]?.name ?? '') : ''))
// Signal only while the radio is on or being tuned: full bars beside STANDBY
// contradicted each other.
const bars = computed(() => (air.value === 'off' ? 0 : signalBars(position.value)))

const legend = computed(() => kindsOnDial(stations.value))

const bezel = Array.from({ length: BEZEL_TICK_COUNT }, (_, index) => ({ index, ...bezelTick(index) }))
const litTick = computed(() => litBezelTick(position.value, count.value))
const knobTurn = computed(() => `rotate(${knobAngle(position.value, count.value)}deg)`)

/** Move the dial to station `to` and tune it in, unless it already plays. */
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
  if (document.activeElement !== grip.value) return
  event.preventDefault()
  const { steps, rest } = wheelSteps(event.deltaY, wheelRest)
  wheelRest = rest
  if (steps === 0) return
  const to = snapIndex(index.value + steps, stations.value.length)
  if (to !== index.value) land(to)
}

function onKnobDown(event: PointerEvent) {
  if (stations.value.length === 0 || event.button > 0) return
  // No text selection while the pointer sweeps across the housing.
  if (event.pointerType === 'mouse') event.preventDefault()
  const target = event.currentTarget as HTMLElement
  // preventDefault above also cancels the focus a mousedown gives: focus by
  // hand, so the wheel tunes after a click (onWheel asks for focus).
  target.focus({ preventScroll: true })
  dragTarget = target
  target.setPointerCapture?.(event.pointerId)
  drag.value = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    start: index.value,
    last: index.value,
  }
  // The music goes quiet while the dial is between stations.
  muteForTuning()
}

function onMove(event: PointerEvent) {
  const current = drag.value
  if (!current || event.pointerId !== current.id) return
  const n = stations.value.length
  const at = knobDragPosition(current.start, event.clientX - current.startX, event.clientY - current.startY, n, KNOB_PX_PER_STATION)
  position.value = at
  const snapped = snapIndex(at, n)
  if (snapped !== current.last) {
    current.last = snapped
    crackle()
  }
}

function onUp(event: PointerEvent) {
  const current = drag.value
  if (!current || event.pointerId !== current.id) return
  drag.value = null
  dragTarget?.releasePointerCapture?.(event.pointerId)
  dragTarget = null
  // A click without a turn only takes the focus (for the wheel and the keys):
  // it must not tune in, nor restart the station that plays.
  const moved = Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) > KNOB_CLICK_SLOP_PX
  if (!moved) {
    position.value = index.value
    resumeMusic()
    return
  }
  land(snapIndex(position.value, stations.value.length))
}

/** Pointer travel below which a press on the knob is a click, not a turn. */
const KNOB_CLICK_SLOP_PX = 4
</script>

<style lang="scss">
// The glass: the display is dark in both themes. Ink is the
// static one (`$mem-ink` does not change with the mode), and the glass colours
// are palette roles mixed in the browser, never in Sass (paletteTokens.test.ts).
$glass-text: color-mix(in srgb, #{$mem-lavender} 35%, #{$mem-paper});
$glass-dim: color-mix(in srgb, #{$mem-lavender} 55%, #{$mem-ink});
$glass-glow: mem-alpha($mem-lavender, 0.55);
$glass-edge: mem-alpha($mem-paper, 0.14);

.radio-card {
  // The page's own edge, like the Browse tiles above the rows. A size container:
  // the now-playing column is a container query on it (wide screens only).
  container-type: inline-size;
  padding: 0 0 1.5rem;

  // Station kinds: one colour each, read through `--kind` by every part that
  // wears it (the legend dot, the chip).
  .kind-mix {
    --kind: #{$mem-pink};
  }
  .kind-genre {
    --kind: #{$mem-teal};
  }
  .kind-decade {
    --kind: #{$mem-yellow};
  }
  .kind-season {
    --kind: #{$mem-coral};
  }

  // The housing: lavender, printed with halftone dots, one plate.
  .radio-case {
    @include mem-arrival;
    position: relative;
    // Clickable, but without the hatch a pressable plate wears: the housing
    // already carries its halftone dots, and strokes over dots read as noise.
    // The toggle button in it is the plate that says "press".
    cursor: pointer;
    overflow: hidden;
    padding: 0.75rem 0.9rem 0.9rem;
    background-color: $mem-lavender;
    border: $candy-border;
    border-radius: $candy-radius;
    box-shadow: mem-shadow(3px, 3px);

    &::before {
      @include mem-halftone($reach: null, $on: accent);
    }

    > .radio-head,
    > .radio-body {
      position: relative;
    }
  }

  // Folded: the housing is the strip alone, a shorter plate, nothing below it.
  .radio-case:not(.is-open) {
    padding: 0.5rem 0.9rem;

    > .radio-head {
      margin-bottom: 0;
    }
  }

  // The header strip: the sticker, the legend of the kinds on the dial, the band.
  .radio-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1rem;
    margin-bottom: 0.8rem;
  }

  .radio-title {
    @include mem-sticker;
    font-size: 1.15rem;
    font-weight: 700;
  }

  // The legend stands on the housing's dots: a veil in the housing's lavender
  // under it, or the small caps drown in the dots (user, 2026-11-15).
  .radio-legend {
    --row-fill: #{$mem-lavender};
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: $mem-ink;
    @include mem-dots-veil(6px, 10px, 0.9);

    > span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    i {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      border: $mem-ring-w solid $mem-ink;
      background: var(--kind);
    }
  }

  .radio-band-range {
    padding: 2px 8px;
    border-radius: $candy-radius-xs;
    background: $mem-ink;
    color: $glass-text;
    font-variant-numeric: tabular-nums;
  }

  // Folded strip: the glass chip with the station on air, lamp first.
  .radio-onair {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 8px;
    border-radius: $candy-radius-xs;
    background: $mem-ink;
    color: $glass-text;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .radio-onair-lamp {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: $mem-coral;
  }

  // The disclosure button: the shared action plate, 44 px like the chrome.
  // The chevron points right folded and down open; it turns, it is not scaled.
  .radio-toggle {
    @include btn-action;
    margin-left: auto;
  }

  // The chevron says where the radio goes: down to open, up to close (the
  // glyph points right, so it turns either way).
  .radio-toggle svg {
    transform: rotate(90deg);
  }

  .radio-toggle.is-open svg {
    transform: rotate(-90deg);
  }

  // Display and knob: two columns on a desktop and on a phone alike, the display
  // taking the free width. (The frequency scale stood under the display until
  // 2026-11-15 and was removed: the knob alone tunes. A speaker grille stood
  // left of the display until the same day and was removed too.)
  .radio-body {
    // The housing around it clicks open and shut; the instrument inside does not.
    cursor: default;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem;
    gap: 0.75rem;
    align-items: stretch;

    @include allPhones {
      grid-template-columns: minmax(0, 1fr) 6.2rem;

      .radio-knob-dial {
        width: 6.2rem;
        height: 6.2rem;
      }
    }
  }

  // The display: dark glass, the readout of the station under the knob.
  .radio-display {
    display: flex;
    align-items: stretch;
    gap: 0.9rem;
    min-width: 0;
    min-height: 7rem;
    padding: 0.55rem 1rem 0.6rem;
    background: $mem-ink;
    color: $glass-text;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    box-shadow: mem-shadow(3px, 3px), inset 0 0 0 2px $glass-edge;
  }

  // The readout keeps its own width; on a wide display the rest goes to what
  // plays (user, 2026-11-15: the title was cut off right while the readout
  // stood in a sea of empty glass on the left).
  .radio-readout {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }

  // The now-playing zone: a dashed divider, then what plays, beside the readout.
  // Wide screens only: below ~760 px the card is a phone's and the zone is gone.
  .radio-now {
    display: none;
  }

  // On wide screens the readout keeps a narrow column (kind, air, frequency,
  // station); the small level meter steps aside, the zone takes the rest.
  @container (min-width: 760px) {
    .radio-readout {
      flex: 0 1 14rem;
    }

    // Scoped through the readout: the base `.radio-level` rule stands later in
    // this file and won the tie (seen on the demo instance at 1800 px).
    .radio-readout .radio-level {
      display: none;
    }

    .radio-now {
      display: grid;
      position: relative;
      flex: 1 1 0;
      grid-template-columns: 6.4rem minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      align-items: center;
      column-gap: 0.8rem;
      row-gap: 0.35rem;
      min-width: 0;
      padding-left: 0.9rem;
      border-left: $mem-hairline-w dashed $glass-dim;

      // Everything but the spectrum sits above it.
      > :not(.radio-spectrum) {
        position: relative;
        z-index: 1;
      }

      > .radio-now-idle {
        grid-column: 1 / -1;
        justify-self: start;
      }

      // Cover left, meta and progress in the middle, the buttons right.
      > .radio-now-cover {
        grid-column: 1;
        grid-row: 1 / span 2;
      }

      > .radio-now-meta {
        grid-column: 2;
        grid-row: 1;
      }

      > .radio-now-acts {
        grid-column: 3;
        grid-row: 1 / span 2;
      }

      > .radio-now-prog {
        grid-column: 2;
        grid-row: 2;
      }
    }
  }

  // The faint spectrum behind the song: from ~46 % of the zone to the buttons,
  // clear of the progress row. Masked in from the left, dim, decoration only.
  .radio-spectrum {
    position: absolute;
    z-index: 0;
    left: 46%;
    right: 6.4rem;
    top: 0.4rem;
    bottom: 1.8rem;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    opacity: 0.22;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 18%);
    mask-image: linear-gradient(to right, transparent, #000 18%);

    i {
      flex: 1;
      height: 100%;
      transform-origin: bottom;
      transform: scaleY(0.12);
      border-radius: 1px;
      background: $glass-text;
    }

    // Running only while ON AIR with a track. Durations and delays step through
    // the level meter's values, so the bars never fall into step.
    &.is-live i {
      animation: radio-level 0.9s ease-in-out infinite alternate;
    }
  }

  $spectrum-durations: 0.62s, 0.71s, 0.81s, 0.93s, 0.97s, 1.07s, 0.68s, 0.9s;
  $spectrum-delays: -0.3s, -0.1s, -0.5s, -0.2s, -0.4s, -0.15s;

  @for $n from 1 through 40 {
    .radio-spectrum.is-live i:nth-child(#{$n}) {
      animation-duration: nth($spectrum-durations, ($n % 8) + 1);
      animation-delay: nth($spectrum-delays, ($n % 6) + 1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .radio-spectrum.is-live i {
      animation: none;
      transform: scaleY(0.3);
    }

    .radio-spectrum.is-live i:nth-child(odd) {
      transform: scaleY(0.5);
    }
  }

  // The cover: a square with the glass ring, the album art or nothing.
  .radio-now-cover {
    display: block;
    width: 6.4rem;
    height: 6.4rem;
    object-fit: cover;
    border: $mem-ring-w solid $glass-dim;
    border-radius: $candy-radius-sm;
  }

  .radio-now-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .radio-now-label {
    color: $glass-dim;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.14em;
  }

  // Two lines before it is cut: most titles fit whole in the wider column.
  .radio-now-title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: $glass-text;
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1.2;
    text-shadow: 0 0 8px $glass-glow;
  }

  .radio-now-artist,
  .radio-now-album {
    overflow: hidden;
    color: $glass-dim;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .radio-now-artist {
    font-size: 0.74rem;
  }

  .radio-now-album {
    font-size: 0.7rem;
  }

  // ♥ and ⏭: round glass buttons, 44 px like the chrome, the ring in the glass dim.
  .radio-now-acts {
    display: flex;
    gap: 0.5rem;
  }

  .radio-gbtn {
    @include focus-ring;
    display: grid;
    flex: none;
    place-items: center;
    width: $bar-control;
    height: $bar-control;
    padding: 0;
    border: $mem-ring-w solid $glass-dim;
    border-radius: 50%;
    background: transparent;
    color: $glass-text;
    cursor: pointer;

    &:hover {
      border-color: $glass-text;
    }

    &.is-on {
      color: $mem-coral;
      border-color: $mem-coral;
    }

    svg {
      width: 1.5rem;
      height: 1.5rem;
    }
  }

  .radio-now-prog {
    display: grid;
    grid-column: 2;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    color: $glass-dim;
    font-size: 0.7rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .radio-now-bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: $glass-edge;

    i {
      position: absolute;
      inset: 0 auto 0 0;
      background: $glass-text;
      box-shadow: 0 0 6px $glass-glow;
    }
  }

  .radio-now-idle {
    color: $glass-dim;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .radio-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .radio-kind {
    padding: 1px 7px;
    border: $mem-ring-w solid $mem-ink;
    border-radius: $candy-radius-xs;
    background: var(--kind);
    color: $mem-ink;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  .radio-air {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    color: $glass-dim;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;

    &.is-on {
      color: $glass-text;
    }
  }

  .radio-lamp {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: $mem-ring-w solid $glass-dim;
  }

  // ON AIR: the coral lamp breathes. TUNING: the yellow one blinks.
  // Both are loops on purpose, outside the motion scale (motionScale.test.ts).
  .radio-air.is-on .radio-lamp {
    border-color: $mem-coral;
    background: $mem-coral;
    animation: radio-glow 1.6s ease-in-out infinite;
  }

  .radio-air.is-tuning .radio-lamp {
    border-color: $mem-yellow;
    background: $mem-yellow;
    animation: radio-blink 0.5s steps(2) infinite;
  }

  @keyframes radio-glow {
    50% {
      box-shadow: 0 0 0 3px mem-alpha($mem-coral, 0.35);
    }
  }

  @keyframes radio-blink {
    50% {
      background: transparent;
    }
  }

  // Four signal bars, lit by the dial position's distance to a station.
  .radio-signal {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;

    i {
      width: 3px;
      border-radius: 1px;
      background: $glass-dim;
      opacity: 0.35;
    }

    i:nth-child(1) {
      height: 4px;
    }
    i:nth-child(2) {
      height: 7px;
    }
    i:nth-child(3) {
      height: 10px;
    }
    i:nth-child(4) {
      height: 12px;
    }

    i.on {
      background: $glass-text;
      opacity: 1;
    }
  }

  .radio-freq {
    font-size: 1.9rem;
    font-weight: 700;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    text-shadow: 0 0 8px $glass-glow;

    small {
      margin-left: 4px;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.06em;
    }
  }

  .radio-name-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    min-width: 0;
  }

  .radio-display-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 1.02rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 0 8px $glass-glow;
  }

  // The level meter: animates only on air, static bars under reduced motion.
  .radio-level {
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 3px;
    height: 2.4rem;

    // Animated through `transform`, not `height`: the meter runs for as long
    // as music plays, and a height loop re-ran layout every frame.
    i {
      width: 4px;
      height: 100%;
      transform: scaleY(0.15);
      transform-origin: bottom;
      border-radius: 1px;
      background: $glass-text;
      opacity: 0.35;
    }

    &.is-on i {
      opacity: 0.95;
      animation: radio-level 0.9s ease-in-out infinite alternate;
    }

    // Out of step on purpose, like PlayingMeter: one speed for all bars would
    // make them look like a progress bar (motionScale.test.ts lists them).
    &.is-on i:nth-child(1) {
      animation-duration: 0.71s;
    }
    &.is-on i:nth-child(2) {
      animation-duration: 0.93s;
      animation-delay: -0.3s;
    }
    &.is-on i:nth-child(3) {
      animation-duration: 0.62s;
      animation-delay: -0.1s;
    }
    &.is-on i:nth-child(4) {
      animation-duration: 1.07s;
      animation-delay: -0.5s;
    }
    &.is-on i:nth-child(5) {
      animation-duration: 0.81s;
      animation-delay: -0.2s;
    }
    &.is-on i:nth-child(6) {
      animation-duration: 0.68s;
      animation-delay: -0.4s;
    }
    &.is-on i:nth-child(7) {
      animation-duration: 0.97s;
      animation-delay: -0.15s;
    }
  }

  @keyframes radio-level {
    0% {
      transform: scaleY(0.15);
    }
    100% {
      transform: scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .radio-level.is-on i {
      animation: none;
      transform: scaleY(0.6);
    }

    .radio-level.is-on i:nth-child(odd) {
      transform: scaleY(0.35);
    }
  }

  // The knob: the one slider. The grip takes the focus; its ring follows the
  // round shape (outlines follow border-radius in every current browser).
  .radio-knob {
    display: grid;
    place-items: center;
  }

  .radio-knob-dial {
    position: relative;
    width: 7rem;
    height: 7rem;
  }

  // The bezel: a fixed ring of ticks printed round the knob, the lit one under the marker.
  .radio-bezel {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;

    .bt {
      stroke: $mem-ink;
      stroke-linecap: round;
    }

    .is-minor {
      stroke-width: 1.6;
      opacity: 0.6;
    }

    .is-major {
      stroke-width: 2.6;
    }

    .is-lit {
      stroke: $mem-paper;
      opacity: 1;
    }

    text {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.18em;
      fill: $mem-ink;
    }
  }

  // The shadow stays bottom right while the knob turns: the filter sits on this
  // wrapper, which does not rotate.
  .radio-grip {
    @include focus-ring;
    position: absolute;
    inset: 13%;
    border-radius: 50%;
    // The plates' offset, through the shape token, as a drop-shadow: a box
    // shadow would turn with the knob's square box.
    filter: drop-shadow(mem-shadow(3px, 3px));
    cursor: grab;
    touch-action: none;
    user-select: none;

    &.is-dragging {
      cursor: grabbing;
    }
  }

  .radio-turn {
    width: 100%;
    height: 100%;
    transition: transform $motion-settle $motion-curve-overshoot;
  }

  .radio-knob.is-still .radio-turn,
  .radio-knob.is-tuning .radio-turn {
    transition: none;
  }

  .radio-knob-svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;

    .k-panel {
      fill: $mem-panel;
    }

    .k-ink {
      fill: none;
      stroke: $mem-ink;
    }

    .k-ridge {
      fill: none;
      stroke: $mem-frame;
    }

    .k-ring {
      fill: none;
      stroke: $mem-ink;
      opacity: 0.25;
    }

    .k-ring-faint {
      opacity: 0.18;
    }

    .k-red {
      stroke: $mem-coral;
      stroke-width: 5;
      stroke-linecap: round;
    }
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
