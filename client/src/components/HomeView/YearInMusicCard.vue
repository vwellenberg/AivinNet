<template>
    <!-- New Year's Eve (#674): the year's Rewind, one door away. Dismissed, it stays away for the year. -->
    <section v-if="year" class="year-music-card" aria-label="Your year in music">
        <div class="year-music-text">
            <h2 class="year-music-title">Your year in music</h2>
            <p class="year-music-sub">{{ year }} in a few plates, from your listening.</p>
        </div>
        <div class="year-music-actions">
            <RouterLink class="year-music-open" :to="{ name: Routes.Rewind, params: { year } }">
                Open
            </RouterLink>
            <button type="button" class="year-music-dismiss" @click="dismiss">
                Not now
            </button>
        </div>
    </section>
</template>

<script setup lang="ts">
// The New Year's review card (#674). It asks Rewind for the years only while the New
// Year's season is on (the date, or the Appearance preview), and the card shows only
// when this year has a Rewind (utils/yearInMusic.ts). The season is read once, at mount,
// as the composable asks once per mount.

// @libraries
import { computed, inject, ref } from "vue";

// @utils
import useRewindYears from "@/composables/useRewindYears";
import { Routes } from "@/router";
import { SEASON_KEY } from "@/utils/seasonLogo";
import { seasonPreview } from "@/utils/seasons";
import { readDismissedYear, rememberDismissedYear, yearInMusicYear } from "@/utils/yearInMusic";

const season = inject(SEASON_KEY, ref(null));
// Only the New Year's season asks the server: the card shows in no other season.
const rewind = useRewindYears(season.value === "newyear");
const dismissedFor = ref(readDismissedYear());

const year = computed(() =>
    yearInMusicYear(rewind.value?.years ?? [], dismissedFor.value, new Date(), seasonPreview.value === "newyear"),
);

function dismiss(): void {
    if (year.value === null) return;
    rememberDismissedYear(year.value);
    dismissedFor.value = year.value;
}
</script>

<style lang="scss">
// A reading plate on the ground (styling.md, `--mem-veil`), the same shape as the
// January Rewind card: the plate is not pressable, its buttons are.
.year-music-card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 2rem;
    padding: 1rem 1.25rem;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow(4px, 4px);
    color: $mem-content-text;

    .year-music-title {
        @include mem-sticker;
        margin: 0 0 0.5rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .year-music-sub {
        margin: 0;
        color: $mem-content-faint;
    }

    .year-music-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
    }

    .year-music-open {
        @include btn-primary;
    }

    .year-music-dismiss {
        @include btn-pill;
    }
}
</style>
