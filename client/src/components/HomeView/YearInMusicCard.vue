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
// The New Year's review card (#674). It shows on New Year's Eve (or in the
// Appearance preview) when this year has a Rewind (utils/yearInMusic.ts).

// @libraries
import { computed, ref } from "vue";

// @utils
import { Routes } from "@/router";
import useHome from "@/stores/home";
import { seasonPreview } from "@/utils/seasons";
import { readDismissedYear, rememberDismissedYear, yearInMusicYear } from "@/utils/yearInMusic";

// The years come with Home's own answer (#776), so the card stands there with the
// rows instead of dropping in above them a request later. It shows on New Year's
// Eve only (`yearInMusicYear`), or in the season preview.
const home = useHome();
const dismissedFor = ref(readDismissedYear());

const year = computed(() =>
    yearInMusicYear(home.rewind?.years ?? [], dismissedFor.value, new Date(), seasonPreview.value === "newyear"),
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
    // Laid down like every plate on Home (ContinueCard.vue); alone, so no stagger.
    @include mem-arrival($steps: 0);
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
