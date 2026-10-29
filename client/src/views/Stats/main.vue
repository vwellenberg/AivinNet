<template>
    <div class="content-page" style="height: 100%; overflow: auto" :style="{ background: brandGradient(BRAND_RED) }">
        <Charts />
        <br><br>
        <!-- A SECTION heading, not the page title: it separates the weekly
             stats from the charts above, so it stays when the nav names the
             page. -->
        <GenericHeader>
            <template #name>Stats</template>
            <template #description>Your listening stats {{ statsPeriodPhrase(settings.statsperiod) }}</template>
        </GenericHeader>
        <Stats :period="normalizeStatsPeriod(settings.statsperiod)" />
        <!-- When in the week, over the same period as the tiles (#535). -->
        <ListeningClock :period="normalizeStatsPeriod(settings.statsperiod)" />
        <!-- How often the tracks were skipped (#537), over the same period. -->
        <SkipRate :period="normalizeStatsPeriod(settings.statsperiod)" />
        <ListeningCalendar :rewind-years="rewind?.years ?? []" />
        <!-- Rewind (#527) is a page of its own; the way there stays at the very
             bottom, seen or not (#572). The news is Home's January card. -->
        <RewindLink :year="latestRewind" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import Charts from '@/components/Stats/Charts.vue'
import GenericHeader from '@/components/shared/GenericHeader.vue'
import ListeningCalendar from '@/components/Stats/ListeningCalendar.vue'
import ListeningClock from '@/components/Stats/ListeningClock.vue'
import RewindLink from '@/components/Stats/RewindLink.vue'
import SkipRate from '@/components/Stats/SkipRate.vue'
import useRewindYears from '@/composables/useRewindYears'
import Stats from '@/components/Stats/Stats.vue'
import useSettings from '@/stores/settings'
import { brandGradient, BRAND_RED } from '@/utils/colortools/pageGradient'
import { normalizeStatsPeriod, statsPeriodPhrase } from '@/utils/statsPeriod'
import updatePageTitle from '@/utils/updatePageTitle'

const settings = useSettings()
// Asked once for both: the link at the bottom and the door in the calendar.
const rewind = useRewindYears()
// Oldest first from the server; the link names the newest.
const latestRewind = computed(() => rewind.value?.years[rewind.value.years.length - 1] ?? null)

updatePageTitle('Stats')
</script>
