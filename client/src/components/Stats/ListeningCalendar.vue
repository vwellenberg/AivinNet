<template>
    <!-- A year of listening (#525): one square a day, shaded by the time
         listened, and the streaks of days in a row with music. Always the last
         year — the period tabs above are about the charts. -->
    <section v-if="calendar" class="listening-calendar">
        <h3 class="section-title">Listening calendar</h3>
        <div class="calendar-plate">
            <div class="calendar-streaks">
                <div class="streak">
                    <div class="streak-value">{{ streakDays(calendar.streaks.current) }}</div>
                    <div class="streak-label">current streak</div>
                </div>
                <div class="streak">
                    <div class="streak-value">{{ streakDays(calendar.streaks.longest) }}</div>
                    <div class="streak-label">
                        longest streak<template v-if="longestRange"> · {{ longestRange }}</template>
                    </div>
                </div>
                <div class="streak">
                    <div class="streak-value">{{ activeDays(calendar) }}</div>
                    <div class="streak-label">days with music in 12 months</div>
                </div>
            </div>

            <!-- Scrolls sideways where the year does not fit (phones), and opens
                 on the latest weeks: those are the ones that change. -->
            <div ref="scroller" class="calendar-scroll">
                <div class="calendar-grid" role="img" :aria-label="summary" :style="{ '--weeks': weeks.length }">
                    <div class="calendar-months" aria-hidden="true">
                        <span v-for="m in months" :key="m.week" :style="{ gridColumn: m.week + 1 }">{{ m.label }}</span>
                    </div>
                    <div class="calendar-days" aria-hidden="true">
                        <template v-for="(week, w) in weeks" :key="w">
                            <span
                                v-for="(day, d) in week"
                                :key="d"
                                class="calendar-day"
                                :class="day ? `level-${day.level}` : 'is-future'"
                                :title="day ? dayTitle(day) : undefined"
                            ></span>
                        </template>
                    </div>
                </div>
            </div>

            <div class="calendar-legend" aria-hidden="true">
                <span>less</span>
                <span v-for="n in 5" :key="n" class="calendar-day" :class="`level-${n - 1}`"></span>
                <span>more</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { getListeningCalendar } from '@/requests/stats'
import {
    CalendarPayload,
    activeDays,
    calendarWeeks,
    dayTitle,
    monthLabels,
    streakDays,
    streakRange,
} from '@/utils/listeningCalendar'

const calendar = ref<CalendarPayload | null>(null)
const scroller = ref<HTMLElement | null>(null)

const weeks = computed(() => (calendar.value ? calendarWeeks(calendar.value) : []))
const months = computed(() => monthLabels(weeks.value))
const longestRange = computed(() => (calendar.value ? streakRange(calendar.value.streaks.longest) : ''))

// The grid is a picture to a screen reader; this is what it shows.
const summary = computed(() => {
    if (!calendar.value) return ''
    const c = calendar.value
    return (
        `Listening calendar: music on ${activeDays(c)} days of the last 12 months. ` +
        `Current streak ${streakDays(c.streaks.current)}, longest ${streakDays(c.streaks.longest)}.`
    )
})

// The server answers one request at a time; leaving the page before it does
// must not paint into a component that is gone.
let alive = true
onUnmounted(() => (alive = false))

onMounted(async () => {
    const res = await getListeningCalendar()
    if (!alive || res.status !== 200) return

    calendar.value = res.data
    await nextTick()
    if (scroller.value) scroller.value.scrollLeft = scroller.value.scrollWidth
})
</script>

<style lang="scss">
.listening-calendar {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    // Text and squares on the doodled ground need a plate (styling.md,
    // `--mem-veil`). Not pressable, so no hatch and no role — a reading panel.
    .calendar-plate {
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

    .calendar-streaks {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem 2rem;
    }

    .streak-value {
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1.2;
    }

    .streak-label {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        color: $mem-content-faint;
    }

    .calendar-scroll {
        overflow-x: auto;
        // Room under the squares for a scrollbar that would otherwise sit on them.
        padding-bottom: 0.25rem;
    }

    $cell: 0.75rem;
    $gap: 3px;

    .calendar-grid {
        display: grid;
        gap: 0.25rem;
        width: max-content;
    }

    .calendar-months,
    .calendar-days {
        display: grid;
        grid-template-columns: repeat(var(--weeks), $cell);
        column-gap: $gap;
    }

    .calendar-months {
        font-size: 0.7rem;
        font-weight: 700;
        color: $mem-content-faint;

        // A month name is wider than its column; it runs on into the next ones.
        span {
            white-space: nowrap;
        }
    }

    // Columns are weeks, Monday on top: the squares flow down, then across.
    .calendar-days {
        grid-template-rows: repeat(7, $cell);
        grid-auto-flow: column;
        row-gap: $gap;
    }

    .calendar-day {
        display: block;
        width: $cell;
        height: $cell;
        border-radius: $candy-radius-xs;
        background-color: mem-alpha($mem-ink, 0.08);

        &.level-1 {
            background-color: mem-alpha($mem-teal, 0.35);
        }

        &.level-2 {
            background-color: mem-alpha($mem-teal, 0.6);
        }

        &.level-3 {
            background-color: mem-alpha($mem-teal, 0.85);
        }

        &.level-4 {
            background-color: $mem-teal;
            // The busiest days get the edge every other plate has: the line,
            // ink in light, grey in dark. Static ink vanished into the dark
            // ground and took 2 px off every side, so the busiest squares
            // looked the smallest (user, 2026-10-23).
            box-shadow: inset 0 0 0 $mem-ring-w $mem-line;
        }

        &.is-future {
            background-color: transparent;
        }
    }

    .calendar-legend {
        display: flex;
        align-items: center;
        gap: $gap;
        font-size: 0.7rem;
        font-weight: 700;
        color: $mem-content-faint;

        span:first-child {
            margin-right: 0.25rem;
        }

        span:last-child {
            margin-left: 0.25rem;
        }
    }
}

// Ink at 8 % disappears on the dark ground; paper is the faint square there.
body.theme-dark .listening-calendar .calendar-day.level-0 {
    background-color: mem-alpha($mem-paper, 0.1);
}
</style>
