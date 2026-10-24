<template>
    <!-- When in the week the music plays (#535): seven rows of 24 hours,
         shaded by the time listened in the period the tabs above chose. The
         calendar below keeps the whole last year. -->
    <section v-if="clock && clock.total" class="listening-clock">
        <h3 class="section-title">When you listen</h3>
        <div class="clock-plate">
            <div class="clock-peaks">
                <div class="clock-peak">
                    <div class="clock-peak-value">{{ busiestHour(clock) }}</div>
                    <div class="clock-peak-label">busiest hour</div>
                </div>
                <div v-if="clock.peak_day" class="clock-peak">
                    <div class="clock-peak-value">{{ WEEKDAYS[clock.peak_day.day] }}</div>
                    <div class="clock-peak-label">busiest day</div>
                </div>
            </div>

            <!-- Server time, and the hours after midnight are the new day's:
                 Friday night at 1 am is Saturday here. -->
            <p class="clock-note">By weekday and hour, {{ phrase }} · after midnight counts as the new day</p>

            <div
                class="clock-grid"
                :class="{ upright }"
                role="img"
                :aria-label="clockSummary(clock, phrase)"
                :style="{ '--columns': layout.width }"
            >
                <span aria-hidden="true"></span>
                <span
                    v-for="column in layout.columns"
                    :key="column.label"
                    class="clock-label"
                    aria-hidden="true"
                    :style="{ gridColumn: `span ${column.span}` }"
                >{{ column.label }}</span>
                <template v-for="(row, r) in layout.rows" :key="r">
                    <span class="clock-label is-row" aria-hidden="true">{{ row.label }}</span>
                    <span
                        v-for="cell in row.cells"
                        :key="`${cell.day}-${cell.hour}`"
                        class="clock-cell"
                        :class="`level-${clockLevel(cell.seconds, busiest)}`"
                        :title="cellTitle(cell.day, cell.hour, cell.seconds)"
                        aria-hidden="true"
                    ></span>
                </template>
            </div>

            <div class="clock-legend" aria-hidden="true">
                <span>less</span>
                <span v-for="n in 5" :key="n" class="clock-cell" :class="`level-${n - 1}`"></span>
                <span>more</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { ClockPayload, getListeningClock } from '@/requests/stats'
import { isSmall } from '@/stores/content-width'
import { busiestHour, cellTitle, clockLayout, clockLevel, clockSummary, WEEKDAYS } from '@/utils/listeningClock'
import { statsPeriodPhrase } from '@/utils/statsPeriod'

const props = defineProps<{ period: string }>()

const clock = ref<ClockPayload | null>(null)
// Upright where the content is a phone's width: 24 columns there are squares
// of 5 to 8 px (measured at 320 and 390).
const upright = computed(() => isSmall.value)
const layout = computed(() => clockLayout(clock.value?.days ?? [], upright.value))
const busiest = computed(() => clock.value?.peak_hour?.seconds ?? 0)
const phrase = computed(() => statsPeriodPhrase(props.period))

// The server answers one request at a time; a period clicked through quickly
// must not paint the answer to an earlier one, and a page left must not be
// painted into at all.
let asked = 0
onUnmounted(() => (asked = -1))

watch(
    () => props.period,
    async period => {
        const ask = ++asked
        const res = await getListeningClock(period)
        if (ask !== asked) return
        clock.value = res.status === 200 ? res.data : null
    },
    { immediate: true }
)
</script>

<style lang="scss">
.listening-clock {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    // A reading panel like the calendar's: text and squares on the doodled
    // ground need a plate (`--mem-veil`), nothing here is pressable.
    .clock-plate {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: fit-content;
        max-width: 100%;
        padding: 1rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
    }

    .clock-peaks {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem 2rem;
    }

    .clock-peak-value {
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1.2;
    }

    .clock-peak-label {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        color: $mem-content-faint;
    }

    .clock-note {
        margin: 0;
        font-size: 0.8rem;
        color: $mem-content-faint;
    }

    $gap: 3px;

    // Wide: squares up to 16 px, a label column for the days. The title of
    // each square names its hour; the labels mark every six.
    .clock-grid {
        display: grid;
        grid-template-columns: max-content repeat(var(--columns), minmax(0, 1rem));
        gap: $gap;
        align-items: center;
    }

    .clock-label,
    .clock-legend {
        font-size: 0.7rem;
        font-weight: 700;
        color: $mem-content-faint;
    }

    .clock-label {
        white-space: nowrap;

        &.is-row {
            padding-right: 0.25rem;
        }
    }

    .clock-cell {
        display: block;
        width: 100%;
        aspect-ratio: 1;
        border-radius: $candy-radius-xs;
        @include listening-shades;
    }

    // Upright (phones): seven day columns as wide as they can be, 24 rows of
    // hours, each a bar the calendar's height.
    .clock-grid.upright {
        grid-template-columns: max-content repeat(var(--columns), minmax(0, 2.5rem));

        .clock-label:not(.is-row) {
            text-align: center;
        }

        .clock-cell {
            aspect-ratio: auto;
            height: 0.75rem;
        }
    }

    .clock-legend {
        display: flex;
        align-items: center;
        gap: $gap;

        .clock-cell {
            width: 0.75rem;
            height: 0.75rem;
        }

        span:first-child {
            margin-right: 0.25rem;
        }

        span:last-child {
            margin-left: 0.25rem;
        }
    }
}
</style>
