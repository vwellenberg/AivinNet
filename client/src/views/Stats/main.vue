<template>
    <div class="content-page" style="height: 100%; overflow: auto" :style="{ background: brandGradient(BRAND_RED) }">
        <!-- Rewind (#527) is a page of its own. While it is news (#572) the way
             there is the first thing on the page, on every layout; seen to
             the end, it is gone, and the page starts with the charts again. -->
        <RewindLink :fresh="rewind?.fresh" />
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
        <ListeningCalendar :rewind-years="rewind?.years ?? []" />
    </div>
</template>

<script setup lang="ts">
import Charts from '@/components/Stats/Charts.vue'
import GenericHeader from '@/components/shared/GenericHeader.vue'
import ListeningCalendar from '@/components/Stats/ListeningCalendar.vue'
import RewindLink from '@/components/Stats/RewindLink.vue'
import useRewindYears from '@/composables/useRewindYears'
import Stats from '@/components/Stats/Stats.vue'
import useSettings from '@/stores/settings'
import { brandGradient, BRAND_RED } from '@/utils/colortools/pageGradient'
import { normalizeStatsPeriod, statsPeriodPhrase } from '@/utils/statsPeriod'
import updatePageTitle from '@/utils/updatePageTitle'

const settings = useSettings()
// Asked once for both: the link while Rewind is news, the door in the calendar after.
const rewind = useRewindYears()

updatePageTitle('Stats')
</script>
