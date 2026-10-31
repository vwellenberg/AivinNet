<template>
    <!-- 1 to 24 December (server-decided, `GET /nothome/advent`): a door per day,
         today's and the past ones open, the future ones locked. The album
         behind an open door is a regular album card. -->
    <section v-if="calendar" class="advent-card" aria-labelledby="advent-title">
        <div class="advent-head">
            <h2 id="advent-title" class="advent-title">Advent calendar</h2>
            <p class="advent-sub">{{ today }} of {{ ADVENT_DOORS }} doors open</p>
        </div>
        <ol class="advent-doors">
            <li v-for="door in doors" :key="door">
                <button
                    type="button"
                    class="advent-door"
                    :class="{
                        'is-today': door === today,
                        'is-open': isOpened(door),
                        'is-locked': door > today,
                        'is-selected': selected === door,
                    }"
                    :disabled="door > today"
                    :aria-pressed="selected === door"
                    :aria-label="doorLabel(door)"
                    @click="openDoor(door)"
                >
                    <span class="advent-door-back" aria-hidden="true">♪</span>
                    <span class="advent-door-leaf" aria-hidden="true">
                        <span class="advent-door-number">{{ door }}</span>
                    </span>
                </button>
            </li>
        </ol>
        <div v-if="selectedDoor" :key="selectedDoor.day" class="advent-stage">
            <AlbumCard :album="selectedDoor.album" />
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import AlbumCard from '@/components/shared/AlbumCard.vue'
import { type AdventCalendar, getAdvent } from '@/requests/home'
import { ADVENT_DOORS, doorOpenable, readOpened, rememberOpened } from '@/utils/advent'

// The year is the device's: the server's answer carries only the day.
const year = new Date().getFullYear()
const calendar = ref<AdventCalendar | null>(null)
const opened = ref<number[]>(readOpened(year))
const selected = ref<number | null>(null)

const today = computed(() => calendar.value?.day ?? 0)
const doors = computed(() => Array.from({ length: ADVENT_DOORS }, (_, i) => i + 1))
const selectedDoor = computed(() => calendar.value?.doors.find(door => door.day === selected.value) ?? null)

function isOpened(door: number): boolean {
    return opened.value.includes(door)
}

function doorLabel(door: number): string {
    if (door > today.value) return `Door ${door}, opens on December ${door}`
    return isOpened(door) ? `Door ${door}, opened` : `Door ${door}, not opened yet`
}

// Opening a door remembers it on this device and shows its album. An open door
// shows its album again when pressed.
function openDoor(door: number) {
    if (!calendar.value || !doorOpenable(door, calendar.value.day)) return

    if (!isOpened(door)) {
        opened.value = [...opened.value, door]
        rememberOpened(year, opened.value)
    }
    selected.value = door
}

onMounted(async () => {
    try {
        const res = await getAdvent()
        const body = res.status === 200 ? (res.data as AdventCalendar) : null
        calendar.value = body && body.day > 0 ? body : null
    } catch {
        // No calendar when the server cannot say: Home just has no card.
        calendar.value = null
    }

    // Today's door, opened earlier on this device, shows its album again.
    if (calendar.value && isOpened(calendar.value.day)) selected.value = calendar.value.day
})
</script>

<style lang="scss">
// A reading plate with a grid of doors (styling.md: the plate is not pressable,
// each door is its own button and carries its role).
.advent-card {
    margin-bottom: 2rem;
    padding: 1rem 1.25rem 1.25rem;
    @include candy-box($mem-panel, $candy-radius);
    @include candy-shadow(4px, 4px);
    color: $mem-content-text;

    .advent-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem 1rem;
        margin-bottom: 0.9rem;
    }

    .advent-title {
        @include mem-sticker;
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .advent-sub {
        margin: 0;
        color: $mem-content-faint;
    }

    .advent-doors {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: $small;
        margin: 0;
        padding: 0;
        list-style: none;

        @include allPhones {
            grid-template-columns: repeat(4, minmax(0, 1fr));
        }
    }

    // The door is the button: its role gives the plate, the shadow and the
    // 44-px target. The leaf turns away on the hinge to show the back.
    .advent-door {
        @include btn-pill($h: 4.25rem, $radius: $candy-radius-sm);
        position: relative;
        display: block;
        width: 100%;
        padding: 0;
        perspective: 600px;
        overflow: hidden;
        text-align: center;

        &.is-today {
            background-color: var(--look-selected-fill, #{$mem-yellow});
            color: var(--look-selected-text, #{$mem-content-text});
            --label-hatch: var(--mem-hatch-accent);
        }

        &.is-locked {
            color: $mem-content-faint;
        }
    }

    .advent-door-back,
    .advent-door-leaf {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
    }

    .advent-door-back {
        font-size: 1.35rem;
    }

    .advent-door-leaf {
        background: inherit;
        transform-origin: left center;
        transition: transform $motion-settle $motion-curve-settle;
    }

    .advent-door.is-open .advent-door-leaf {
        transform: rotateY(-100deg);
    }

    .advent-door-number {
        font-size: 1.1rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .advent-stage {
        margin-top: 1rem;
        max-width: 14rem;
    }
}
</style>
