<template>
    <!-- The pill: the clock to midnight, then the greeting. Nothing when there is no countdown. -->
    <span v-if="view" class="newyear-countdown" :class="{ 'is-greeting': view.kind === 'celebrating' }">
        <template v-if="view.kind === 'counting'">{{ clock }}</template>
        <template v-else-if="compact">🎉 {{ newYear }}</template>
        <template v-else>Happy New Year 🎉</template>
    </span>
</template>

<script setup lang="ts">
// The top bar's New Year's pill (#674). Mounted only in the New Year's season (NavBar.vue),
// so the clock runs nowhere else. One interval, once a second, and only while the tab is
// visible. A page that was open across midnight fires the confetti once for the year
// (utils/newYearCountdown.ts, the remembered year in localStorage).

// @libraries
import { useDocumentVisibility } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

// @utils
import { celebrate } from "@/utils/confetti";
import { seasonPreview } from "@/utils/seasons";
import {
    clockText,
    confettiDue,
    countdownAt,
    crossedNewYear,
    readCelebratedYear,
    rememberCelebratedYear,
} from "@/utils/newYearCountdown";

// On a phone the top bar holds the page title, this pill and two buttons in one
// pill-shaped row: "Happy New Year 🎉" pushed the avatar past the screen edge
// (measured at 390 px). The phone gets the short form, "🎉 2027".
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const SECOND_MS = 1000;
const CONFETTI_PIECES = 40;

const now = ref(new Date());
const visibility = useDocumentVisibility();
// The reading before the last tick: a midnight between it and the next one is the crossing.
let lastTick = new Date();
let timer: ReturnType<typeof setInterval> | undefined;

const view = computed(() => {
    const c = countdownAt(now.value, seasonPreview.value === "newyear");
    return c.kind === "none" ? null : c;
});

const newYear = computed(() => now.value.getFullYear() + (now.value.getMonth() === 11 ? 1 : 0));

const clock = computed(() => {
    const c = view.value;
    return c && c.kind === "counting" ? clockText(c.remainingMs) : "";
});

function tick(): void {
    const t = new Date();
    const year = crossedNewYear(lastTick, t);
    lastTick = t;
    now.value = t;
    // A crossing is one reading, so it comes once per mount; the remembered year keeps it to once per year.
    if (year !== null && confettiDue(year, readCelebratedYear())) {
        rememberCelebratedYear(year);
        celebrate(CONFETTI_PIECES);
    }
}

function start(): void {
    if (timer !== undefined) return;
    tick();
    timer = setInterval(tick, SECOND_MS);
}

function stop(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
}

watch(visibility, (state) => (state === "visible" ? start() : stop()));

onMounted(() => {
    if (visibility.value === "visible") start();
});

onBeforeUnmount(stop);
</script>

<style lang="scss">
// ============================================================================
// THE NEW YEAR'S PILL (#674): a small chip in the top bar, the clock to midnight.
//
// It is a fixed gold chip with ink type, so it reads the same in light and dark
// (the accent `--mem-yellow` does not change with the mode, and the ink is the static
// `$candy-black`). The digits are tabular, so the clock ticks without the chip
// moving. It takes no pointer and never shrinks in the bar.
// ============================================================================

.newyear-countdown {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    align-self: center;
    height: 2rem;
    padding: 0 0.75rem;
    border: $candy-border;
    border-radius: $candy-radius-pill;
    background: var(--mem-yellow);
    color: $candy-black;
    font-size: 0.95rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
}
</style>
