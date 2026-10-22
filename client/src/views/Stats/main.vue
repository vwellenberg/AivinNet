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
    </div>
</template>

<script setup lang="ts">
import Charts from '@/components/Stats/Charts.vue'
import GenericHeader from '@/components/shared/GenericHeader.vue'
import Stats from '@/components/Stats/Stats.vue'
import useSettings from '@/stores/settings'
import { brandGradient, BRAND_RED } from '@/utils/colortools/pageGradient'
import { normalizeStatsPeriod, statsPeriodPhrase } from '@/utils/statsPeriod'
import updatePageTitle from '@/utils/updatePageTitle'

const settings = useSettings()

updatePageTitle('Stats')
</script>
